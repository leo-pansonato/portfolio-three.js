import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { devMode } from "../managers/DevModeManager";
import PhysicsDebugRenderer from "./PhysicsDebugRenderer";
import {
	ColliderConfig,
	PhysicsBody,
	PhysicsObjectCounts,
	PhysicsWorld,
	PoseTarget,
	RaycastHit,
	RaycastVehicle,
	RigidBodyConfig,
	Vec3Like,
} from "./PhysicsWorld";
import RapierBody from "./RapierBody";
import RapierVehicle from "./RapierVehicle";

/**
 * Corpo registrado para interpolação, com a pose do passo anterior
 */
interface PhysicsEntity {
	body: RapierBody;
	target: PoseTarget;
	previousPosition: THREE.Vector3;
	previousQuaternion: THREE.Quaternion;
}

function rapierBody(body: PhysicsBody): RapierBody {
	if (!(body instanceof RapierBody)) throw new Error("Corpo não pertence a um RapierPhysicsWorld");
	return body;
}

function rapierVehicle(vehicle: RaycastVehicle): RapierVehicle {
	if (!(vehicle instanceof RapierVehicle)) throw new Error("Veículo não pertence a um RapierPhysicsWorld");
	return vehicle;
}

/**
 * Adaptador Rapier (WASM) do PhysicsWorld; único módulo, com seus auxiliares, que importa o motor.
 * Inicialização assíncrona: use RapierPhysicsWorld.create(scene).
 */
export default class RapierPhysicsWorld implements PhysicsWorld {
	private scene: THREE.Scene;
	private world!: RAPIER.World;
	private debugRenderer: PhysicsDebugRenderer | null = null;

	private entities: PhysicsEntity[] = [];
	private entityByHandle = new Map<number, PhysicsEntity>();
	/** Todos os corpos criados por este mundo, pelo handle da Rapier */
	private bodyByHandle = new Map<number, RapierBody>();
	private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

	/** Passo fixo da simulação (s) */
	readonly fixedTimeStep: number;
	private accumulator: number = 0;
	/** Fração do passo acumulada e não simulada (0–1): peso da pose atual na interpolação */
	private interpolationAlpha: number = 0;
	private _position = new THREE.Vector3();
	private _quaternion = new THREE.Quaternion();

	private preStepCallbacks: Array<(dt: number) => void> = [];

	// Grupos de colisão
	public static readonly COLLISION_GROUP_GROUND = 0x0001;
	public static readonly COLLISION_GROUP_VEHICLE = 0x0002;
	public static readonly COLLISION_GROUP_OBSTACLE = 0x0004;
	public static readonly COLLISION_GROUP_ALL = 0xffff;

	private constructor(scene: THREE.Scene, fixedTimeStep: number) {
		this.scene = scene;
		this.fixedTimeStep = fixedTimeStep;
	}

	/**
	 * Inicializa o WASM da Rapier e cria o mundo
	 * @param scene cena do debug renderer (modo dev)
	 * @param fixedTimeStep passo fixo da simulação (s)
	 */
	public static async create(scene: THREE.Scene, fixedTimeStep: number = 1 / 60): Promise<RapierPhysicsWorld> {
		await RAPIER.init();

		const physicsWorld = new RapierPhysicsWorld(scene, fixedTimeStep);
		physicsWorld.initWorld();

		devMode.subscribe("physics-manager", (enabled) => physicsWorld.onChangeDevMode(enabled));

		return physicsWorld;
	}

	private initWorld(): void {
		// gravidade em −Y (m/s²)
		const gravity = new RAPIER.Vector3(0, -9.82, 0);
		this.world = new RAPIER.World(gravity);
		this.world.timestep = this.fixedTimeStep;
	}

	update(deltaTime: number): void {
		this.accumulator += deltaTime;

		while (this.accumulator >= this.fixedTimeStep) {
			this.savePreviousPoses();

			for (const callback of this.preStepCallbacks) {
				callback(this.fixedTimeStep);
			}

			this.world.step();
			this.accumulator -= this.fixedTimeStep;
		}
		this.interpolationAlpha = this.accumulator / this.fixedTimeStep;

		this.syncTargets();
		this.updateDebugger();
	}

	addPreStepCallback(callback: (dt: number) => void): void {
		this.preStepCallbacks.push(callback);
	}

	removePreStepCallback(callback: (dt: number) => void): void {
		const index = this.preStepCallbacks.indexOf(callback);
		if (index !== -1) {
			this.preStepCallbacks.splice(index, 1);
		}
	}

	getInterpolationAlpha(): number {
		return this.interpolationAlpha;
	}

	getInterpolatedPose(body: PhysicsBody, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean {
		for (const entity of this.entities) {
			if (entity.body === body) {
				this.interpolate(entity, outPosition, outQuaternion);
				return true;
			}
		}
		return false;
	}

	resetInterpolation(body: PhysicsBody): void {
		for (const entity of this.entities) {
			if (entity.body === body) this.savePreviousPose(entity);
		}
	}

	private savePreviousPoses(): void {
		for (const entity of this.entities) this.savePreviousPose(entity);
	}

	private savePreviousPose(entity: PhysicsEntity): void {
		entity.body.getPosition(entity.previousPosition);
		entity.body.getRotation(entity.previousQuaternion);
	}

	private interpolate(entity: PhysicsEntity, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
		entity.body.getPosition(this._position);
		entity.body.getRotation(this._quaternion);
		outPosition.lerpVectors(entity.previousPosition, this._position, this.interpolationAlpha);
		outQuaternion.slerpQuaternions(entity.previousQuaternion, this._quaternion, this.interpolationAlpha);
	}

	/** Aplica a pose interpolada aos alvos dos corpos não estáticos */
	private syncTargets(): void {
		for (const entity of this.entities) {
			if (entity.body.raw.bodyType() === RAPIER.RigidBodyType.Fixed) {
				continue;
			}
			this.interpolate(entity, entity.target.position, entity.target.quaternion);
		}
	}

	createRigidBody(config: RigidBodyConfig): PhysicsBody {
		let rigidBodyDesc: RAPIER.RigidBodyDesc;

		switch (config.type) {
			case "dynamic":
				rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
				break;
			case "static":
				rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
				break;
			case "kinematicPositionBased":
				rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
				break;
			case "kinematicVelocityBased":
				rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
				break;
			default:
				rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
		}

		rigidBodyDesc.setTranslation(config.position.x, config.position.y, config.position.z);

		if (config.rotation) {
			rigidBodyDesc.setRotation({
				x: config.rotation.x,
				y: config.rotation.y,
				z: config.rotation.z,
				w: config.rotation.w,
			});
		}

		if (config.linearDamping !== undefined) {
			rigidBodyDesc.setLinearDamping(config.linearDamping);
		}
		if (config.angularDamping !== undefined) {
			rigidBodyDesc.setAngularDamping(config.angularDamping);
		}

		if (config.canSleep !== undefined) {
			rigidBodyDesc.setCanSleep(config.canSleep);
		}

		if (config.ccdEnabled) {
			rigidBodyDesc.setCcdEnabled(true);
		}

		const body = new RapierBody(this.world.createRigidBody(rigidBodyDesc));
		this.bodyByHandle.set(body.raw.handle, body);
		return body;
	}

	createCollider(config: ColliderConfig, body: PhysicsBody): void {
		let colliderDesc: RAPIER.ColliderDesc;

		switch (config.shape) {
			case "box":
			case "cuboid":
				if (!config.halfExtents) {
					throw new Error("halfExtents é obrigatório para shape box/cuboid");
				}
				colliderDesc = RAPIER.ColliderDesc.cuboid(
					config.halfExtents.x,
					config.halfExtents.y,
					config.halfExtents.z,
				);
				break;

			case "ball":
				if (config.radius === undefined) {
					throw new Error("radius é obrigatório para shape ball");
				}
				colliderDesc = RAPIER.ColliderDesc.ball(config.radius);
				break;

			case "capsule":
				if (config.halfHeight === undefined || config.radius === undefined) {
					throw new Error("halfHeight e radius são obrigatórios para shape capsule");
				}
				colliderDesc = RAPIER.ColliderDesc.capsule(config.halfHeight, config.radius);
				break;

			case "cylinder":
				if (config.halfHeight === undefined || config.radius === undefined) {
					throw new Error("halfHeight e radius são obrigatórios para shape cylinder");
				}
				colliderDesc = RAPIER.ColliderDesc.cylinder(config.halfHeight, config.radius);
				break;

			default:
				throw new Error(`Shape não suportada: ${config.shape}`);
		}

		if (config.friction !== undefined) {
			colliderDesc.setFriction(config.friction);
		}
		if (config.restitution !== undefined) {
			colliderDesc.setRestitution(config.restitution);
		}
		if (config.density !== undefined) {
			colliderDesc.setDensity(config.density);
		}

		if (config.translation) {
			colliderDesc.setTranslation(config.translation.x, config.translation.y, config.translation.z);
		}
		if (config.rotation) {
			colliderDesc.setRotation({
				x: config.rotation.x,
				y: config.rotation.y,
				z: config.rotation.z,
				w: config.rotation.w,
			});
		}

		this.world.createCollider(colliderDesc, rapierBody(body).raw);
		this.debugRenderer?.invalidate();
	}

	createGroundCollider(body: PhysicsBody, friction: number = 0.8, halfSize: number = 100): void {
		const colliderDesc = RAPIER.ColliderDesc.cuboid(halfSize, 0.1, halfSize)
			.setFriction(friction)
			.setRestitution(0.0)
			.setTranslation(0, -0.1, 0);

		this.world.createCollider(colliderDesc, rapierBody(body).raw);
		this.debugRenderer?.invalidate();
	}

	createVehicleController(chassis: PhysicsBody): RaycastVehicle {
		return new RapierVehicle(this.world.createVehicleController(rapierBody(chassis).raw));
	}

	removeVehicleController(vehicle: RaycastVehicle): void {
		this.world.removeVehicleController(rapierVehicle(vehicle).raw);
	}

	addEntity(body: PhysicsBody, target: PoseTarget): void {
		const entity = {
			body: rapierBody(body),
			target,
			previousPosition: new THREE.Vector3(),
			previousQuaternion: new THREE.Quaternion(),
		};
		this.savePreviousPose(entity);
		this.entities.push(entity);
		this.entityByHandle.set(entity.body.raw.handle, entity);
	}

	removeRigidBody(body: PhysicsBody): void {
		const index = this.entities.findIndex((e) => e.body === body);
		if (index !== -1) this.entities.splice(index, 1);
		const raw = rapierBody(body).raw;
		this.entityByHandle.delete(raw.handle);
		this.bodyByHandle.delete(raw.handle);
		this.world.removeRigidBody(raw);
		this.debugRenderer?.invalidate();
	}

	getRigidBodyForMesh(mesh: THREE.Object3D): PhysicsBody | null {
		const entity = this.entities.find((e) => e.target === mesh);
		return entity ? entity.body : null;
	}

	private addDebugger(): void {
		if (!this.debugRenderer && this.scene) {
			this.debugRenderer = new PhysicsDebugRenderer(this.scene, this.world, (body, outPosition, outQuaternion) =>
				this.debugPose(body, outPosition, outQuaternion),
			);
		}
	}

	private debugPose(body: RAPIER.RigidBody, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
		const entity = this.entityByHandle.get(body.handle);
		if (entity && body.bodyType() !== RAPIER.RigidBodyType.Fixed) {
			this.interpolate(entity, outPosition, outQuaternion);
			return;
		}
		const position = body.translation();
		const rotation = body.rotation();
		outPosition.set(position.x, position.y, position.z);
		outQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
	}

	private updateDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.update();
		}
	}

	private removeDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.dispose();
			this.debugRenderer = null;
		}
	}

	private onChangeDevMode(enabled: boolean): void {
		if (enabled) {
			this.addDebugger();
		} else {
			this.removeDebugger();
		}
	}

	castRay(origin: Vec3Like, direction: Vec3Like, maxDistance: number): number | null {
		const ray = new RAPIER.Ray(
			new RAPIER.Vector3(origin.x, origin.y, origin.z),
			new RAPIER.Vector3(direction.x, direction.y, direction.z),
		);

		const hit = this.world.castRay(ray, maxDistance, true);
		return hit ? hit.timeOfImpact : null;
	}

	castRayWithNormal(
		origin: Vec3Like,
		direction: Vec3Like,
		maxDistance: number,
		out: RaycastHit,
		excludeBody?: PhysicsBody,
	): boolean {
		const ray = this.ray;
		ray.origin.x = origin.x;
		ray.origin.y = origin.y;
		ray.origin.z = origin.z;
		ray.dir.x = direction.x;
		ray.dir.y = direction.y;
		ray.dir.z = direction.z;

		const exclude = excludeBody ? rapierBody(excludeBody).raw : undefined;
		const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, undefined, exclude);
		if (!hit) return false;

		const distance = hit.timeOfImpact;
		out.distance = distance;
		out.point.x = origin.x + direction.x * distance;
		out.point.y = origin.y + direction.y * distance;
		out.point.z = origin.z + direction.z * distance;
		out.normal.x = hit.normal.x;
		out.normal.y = hit.normal.y;
		out.normal.z = hit.normal.z;
		const parent = hit.collider.parent();
		out.body = parent ? (this.bodyByHandle.get(parent.handle) ?? null) : null;
		return true;
	}

	countObjects(): PhysicsObjectCounts {
		return {
			bodies: this.world.bodies.len(),
			colliders: this.world.colliders.len(),
			vehicleControllers: this.world.vehicleControllers.size,
		};
	}

	dispose(): void {
		this.removeDebugger();
		this.entities = [];
		this.entityByHandle.clear();
		this.bodyByHandle.clear();
		this.world.free();
	}
}
