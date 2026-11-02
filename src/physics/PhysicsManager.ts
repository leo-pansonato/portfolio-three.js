import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { devMode } from "../managers/DevModeManager";
import PhysicsDebugRenderer from "./PhysicsDebugRenderer";

/**
 * Configuração para criar um RigidBody
 */
export interface RigidBodyConfig {
	type: "dynamic" | "static" | "kinematicPositionBased" | "kinematicVelocityBased";
	position: { x: number; y: number; z: number };
	rotation?: { x: number; y: number; z: number; w: number };
	mass?: number;
	linearDamping?: number;
	angularDamping?: number;
	canSleep?: boolean;
	ccdEnabled?: boolean;
}

/**
 * Configuração para criar um Collider
 */
export interface ColliderConfig {
	shape: "box" | "ball" | "capsule" | "cylinder" | "cuboid" | "trimesh" | "heightfield";
	// Para box/cuboid
	halfExtents?: { x: number; y: number; z: number };
	// Para ball
	radius?: number;
	// Para capsule/cylinder
	halfHeight?: number;
	// Propriedades físicas
	friction?: number;
	restitution?: number;
	density?: number;
	// Offset local
	translation?: { x: number; y: number; z: number };
	rotation?: { x: number; y: number; z: number; w: number };
}

/**
 * Par de RigidBody e Mesh para sincronização, com a pose do passo anterior para interpolação
 */
interface PhysicsEntity {
	rigidBody: RAPIER.RigidBody;
	mesh: THREE.Object3D;
	previousPosition: THREE.Vector3;
	previousQuaternion: THREE.Quaternion;
}

/**
 * Gerenciador de física usando Rapier (WASM)
 * 
 * IMPORTANTE: Deve ser inicializado de forma assíncrona antes de usar.
 * Use PhysicsManager.create(scene) ao invés do construtor.
 */
export default class PhysicsManager {
	private scene: THREE.Scene;
	public world!: RAPIER.World;
	private debugRenderer: PhysicsDebugRenderer | null = null;

	private entities: PhysicsEntity[] = [];

	/** Passo fixo da simulação (s) */
	private readonly fixedTimeStep: number;
	private accumulator: number = 0;
	/** Fração do passo acumulada e não simulada (0–1): peso da pose atual na interpolação */
	private interpolationAlpha: number = 0;
	private _position = new THREE.Vector3();
	private _quaternion = new THREE.Quaternion();

	// Callbacks para serem chamados antes de cada step da física
	private preStepCallbacks: Array<(dt: number) => void> = [];

	// Grupos de colisão
	public static readonly COLLISION_GROUP_GROUND = 0x0001;
	public static readonly COLLISION_GROUP_VEHICLE = 0x0002;
	public static readonly COLLISION_GROUP_OBSTACLE = 0x0004;
	public static readonly COLLISION_GROUP_ALL = 0xFFFF;

	/**
	 * Construtor privado - use PhysicsManager.create() para instanciar
	 */
	private constructor(scene: THREE.Scene, fixedTimeStep: number) {
		this.scene = scene;
		this.fixedTimeStep = fixedTimeStep;
	}

	/**
	 * Factory method assíncrono para criar o PhysicsManager
	 * Inicializa o WASM do Rapier antes de criar o mundo
	 * @param fixedTimeStep passo fixo da simulação (s)
	 */
	public static async create(scene: THREE.Scene, fixedTimeStep: number = 1 / 60): Promise<PhysicsManager> {
		// Inicializar o WASM do Rapier (OBRIGATÓRIO antes de qualquer operação)
		await RAPIER.init();

		const manager = new PhysicsManager(scene, fixedTimeStep);
		manager.initWorld();

		// Inscrever no dev mode para debug
		devMode.subscribe("physics-manager", (enabled) => manager.onChangeDevMode(enabled));

		return manager;
	}

	/**
	 * Inicializa o mundo físico do Rapier
	 */
	private initWorld(): void {
		// Criar o mundo com gravidade
		const gravity = new RAPIER.Vector3(0, -9.82, 0);
		this.world = new RAPIER.World(gravity);
		this.world.timestep = this.fixedTimeStep;
	}

	/**
	 * Atualiza o mundo físico e sincroniza com o visual
	 * @param deltaTime Tempo decorrido desde o último frame (segundos)
	 */
	update(deltaTime: number): void {
		// Acumular tempo
		this.accumulator += deltaTime;

		// Executar passos fixos da física
		while (this.accumulator >= this.fixedTimeStep) {
			this.savePreviousPoses();

			// Executar callbacks pré-step (ex: atualizar vehicle controllers)
			for (const callback of this.preStepCallbacks) {
				callback(this.fixedTimeStep);
			}

			this.world.step();
			this.accumulator -= this.fixedTimeStep;
		}
		this.interpolationAlpha = this.accumulator / this.fixedTimeStep;

		// Sincronizar visuais com a física (interpolados entre os dois últimos passos)
		this.syncMeshes();

		// Atualizar debugger se ativo
		this.updateDebugger();
	}

	/**
	 * Registra um callback para ser chamado antes de cada step da física
	 * Útil para atualizar vehicle controllers com timestep fixo
	 */
	addPreStepCallback(callback: (dt: number) => void): void {
		this.preStepCallbacks.push(callback);
	}

	/**
	 * Remove um callback de pré-step
	 */
	removePreStepCallback(callback: (dt: number) => void): void {
		const index = this.preStepCallbacks.indexOf(callback);
		if (index !== -1) {
			this.preStepCallbacks.splice(index, 1);
		}
	}

	/**
	 * Retorna o timestep fixo usado pela física
	 */
	getFixedTimeStep(): number {
		return this.fixedTimeStep;
	}

	/**
	 * Fração do passo ainda não simulada (0–1), para interpolar estado próprio entre passos
	 */
	getInterpolationAlpha(): number {
		return this.interpolationAlpha;
	}

	/**
	 * Pose de uma entidade interpolada entre os dois últimos passos (o visual fica até 1 passo atrás)
	 * @returns false se o corpo não está registrado com addEntity
	 */
	getInterpolatedPose(rigidBody: RAPIER.RigidBody, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean {
		for (const entity of this.entities) {
			if (entity.rigidBody === rigidBody) {
				this.interpolate(entity, outPosition, outQuaternion);
				return true;
			}
		}
		return false;
	}

	/**
	 * Descarta a pose anterior após teleporte, para não interpolar o salto
	 */
	resetInterpolation(rigidBody: RAPIER.RigidBody): void {
		for (const entity of this.entities) {
			if (entity.rigidBody === rigidBody) this.copyPose(rigidBody, entity.previousPosition, entity.previousQuaternion);
		}
	}

	private savePreviousPoses(): void {
		for (const entity of this.entities) {
			this.copyPose(entity.rigidBody, entity.previousPosition, entity.previousQuaternion);
		}
	}

	private copyPose(rigidBody: RAPIER.RigidBody, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
		const position = rigidBody.translation();
		const rotation = rigidBody.rotation();
		outPosition.set(position.x, position.y, position.z);
		outQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
	}

	private interpolate(entity: PhysicsEntity, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
		this.copyPose(entity.rigidBody, this._position, this._quaternion);
		outPosition.lerpVectors(entity.previousPosition, this._position, this.interpolationAlpha);
		outQuaternion.slerpQuaternions(entity.previousQuaternion, this._quaternion, this.interpolationAlpha);
	}

	/**
	 * Sincroniza as meshes visuais com os corpos físicos
	 */
	private syncMeshes(): void {
		for (const entity of this.entities) {
			// Pular corpos estáticos (não se movem)
			if (entity.rigidBody.bodyType() === RAPIER.RigidBodyType.Fixed) {
				continue;
			}
			this.interpolate(entity, entity.mesh.position, entity.mesh.quaternion);
		}
	}

	/**
	 * Cria um RigidBody no mundo físico
	 */
	createRigidBody(config: RigidBodyConfig): RAPIER.RigidBody {
		let rigidBodyDesc: RAPIER.RigidBodyDesc;

		// Criar descritor baseado no tipo
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

		// Configurar posição
		rigidBodyDesc.setTranslation(config.position.x, config.position.y, config.position.z);

		// Configurar rotação se fornecida
		if (config.rotation) {
			rigidBodyDesc.setRotation({
				x: config.rotation.x,
				y: config.rotation.y,
				z: config.rotation.z,
				w: config.rotation.w,
			});
		}

		// Configurar damping
		if (config.linearDamping !== undefined) {
			rigidBodyDesc.setLinearDamping(config.linearDamping);
		}
		if (config.angularDamping !== undefined) {
			rigidBodyDesc.setAngularDamping(config.angularDamping);
		}

		// Configurar sleep
		if (config.canSleep !== undefined) {
			rigidBodyDesc.setCanSleep(config.canSleep);
		}

		// Configurar CCD (Continuous Collision Detection)
		if (config.ccdEnabled) {
			rigidBodyDesc.setCcdEnabled(true);
		}

		// Criar e retornar o RigidBody
		return this.world.createRigidBody(rigidBodyDesc);
	}

	/**
	 * Cria um Collider e o associa a um RigidBody
	 */
	createCollider(config: ColliderConfig, rigidBody: RAPIER.RigidBody): RAPIER.Collider {
		let colliderDesc: RAPIER.ColliderDesc;

		// Criar descritor baseado na forma
		switch (config.shape) {
			case "box":
			case "cuboid":
				if (!config.halfExtents) {
					throw new Error("halfExtents é obrigatório para shape box/cuboid");
				}
				colliderDesc = RAPIER.ColliderDesc.cuboid(
					config.halfExtents.x,
					config.halfExtents.y,
					config.halfExtents.z
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

		// Configurar propriedades físicas
		if (config.friction !== undefined) {
			colliderDesc.setFriction(config.friction);
		}
		if (config.restitution !== undefined) {
			colliderDesc.setRestitution(config.restitution);
		}
		if (config.density !== undefined) {
			colliderDesc.setDensity(config.density);
		}

		// Configurar offset local
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

		// Criar e retornar o Collider associado ao RigidBody
		return this.world.createCollider(colliderDesc, rigidBody);
	}

	/**
	 * Cria o chão: cuboid fino com a superfície em y=0, de -halfSize a +halfSize (m) em X e Z
	 */
	createGroundCollider(rigidBody: RAPIER.RigidBody, friction: number = 0.8, halfSize: number = 100): RAPIER.Collider {
		const colliderDesc = RAPIER.ColliderDesc.cuboid(halfSize, 0.1, halfSize)
			.setFriction(friction)
			.setRestitution(0.0)
			.setTranslation(0, -0.1, 0); // Posicionar a superfície no y=0

		return this.world.createCollider(colliderDesc, rigidBody);
	}

	/**
	 * Adiciona um par RigidBody-Mesh para sincronização automática
	 */
	addEntity(rigidBody: RAPIER.RigidBody, mesh: THREE.Object3D): void {
		const entity = { rigidBody, mesh, previousPosition: new THREE.Vector3(), previousQuaternion: new THREE.Quaternion() };
		this.copyPose(rigidBody, entity.previousPosition, entity.previousQuaternion);
		this.entities.push(entity);
	}

	/**
	 * Remove uma entidade da sincronização e do mundo físico
	 */
	removeEntity(rigidBody: RAPIER.RigidBody): void {
		const index = this.entities.findIndex((e) => e.rigidBody === rigidBody);
		if (index !== -1) {
			this.entities.splice(index, 1);
			this.world.removeRigidBody(rigidBody);
		}
	}

	/**
	 * Obtém o RigidBody associado a uma mesh
	 */
	getRigidBodyForMesh(mesh: THREE.Object3D): RAPIER.RigidBody | null {
		const entity = this.entities.find((e) => e.mesh === mesh);
		return entity ? entity.rigidBody : null;
	}

	/**
	 * Ativa o debug renderer
	 */
	addDebugger(): void {
		if (!this.debugRenderer && this.scene) {
			this.debugRenderer = new PhysicsDebugRenderer(this.scene, this.world);
		}
	}

	/**
	 * Atualiza o debug renderer
	 */
	updateDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.update();
		}
	}

	/**
	 * Remove o debug renderer
	 */
	removeDebugger(): void {
		if (this.debugRenderer) {
			this.debugRenderer.dispose();
			this.debugRenderer = null;
		}
	}

	/**
	 * Callback para mudança do modo de desenvolvimento
	 */
	onChangeDevMode(enabled: boolean): void {
		if (enabled) {
			this.addDebugger();
		} else {
			this.removeDebugger();
		}
	}

	/**
	 * Realiza um raycast no mundo físico
	 */
	castRay(
		origin: { x: number; y: number; z: number },
		direction: { x: number; y: number; z: number },
		maxDistance: number
	): RAPIER.RayColliderHit | null {
		const ray = new RAPIER.Ray(
			new RAPIER.Vector3(origin.x, origin.y, origin.z),
			new RAPIER.Vector3(direction.x, direction.y, direction.z)
		);

		return this.world.castRay(ray, maxDistance, true);
	}

	/**
	 * Obtém a instância do Rapier para uso externo
	 */
	getRapier(): typeof RAPIER {
		return RAPIER;
	}

	/**
	 * Limpa todos os recursos
	 */
	dispose(): void {
		this.removeDebugger();
		this.entities = [];
		this.world.free();
	}
}
