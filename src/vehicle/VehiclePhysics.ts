import * as THREE from "three";
import { VehicleDefinition } from "../data/vehicles/types";
import {
	createRaycastHit,
	PhysicsBody,
	PhysicsWorld,
	QuatLike,
	RaycastHit,
	RaycastVehicle,
	Vec3Like,
} from "../physics/PhysicsWorld";
import { aerodynamicDragImpulse } from "./aerodynamics";
import Suspension from "./Suspension";
import { VehicleCommands } from "./VehicleControl";
import { VehicleState } from "./VehicleState";
import { createVehicleTelemetry, createWheelTelemetry, STANDARD_GRAVITY, VehicleTelemetry } from "./VehicleTelemetry";

/** Valores de uma roda no passo anterior, para a interpolação visual */
export interface WheelStepState {
	/** Comprimento da suspensão (m) */
	previousSuspensionLength: number;
	/** Esterço (rad) */
	previousSteering: number;
	/** Giro acumulado (rad) */
	previousRotation: number;
}

/** Estado dinâmico do chassi no mundo (m, m/s, rad/s) */
export interface ChassisState {
	position: Vec3Like;
	rotation: QuatLike;
	linearVelocity: Vec3Like;
	angularVelocity: Vec3Like;
}

/**
 * Física de um veículo: chassi (corpo dinâmico + cuboid), suspensão própria por roda (raio pelo PhysicsWorld,
 * impulso no ponto de fixação) e controlador de veículo por raycast só para os pneus.
 * Dono desses objetos do motor; `destroy()` os remove do mundo.
 * Eixos do chassi (ADR-0002): frente +X, cima +Y, direita +Z; THREE só para matemática.
 */
export default class VehiclePhysics {
	readonly chassisBody: PhysicsBody;
	readonly controller: RaycastVehicle;
	readonly wheels: WheelStepState[] = [];
	readonly telemetry: VehicleTelemetry = createVehicleTelemetry();
	readonly suspension: Suspension;

	private readonly suspensionRestLength: number;
	/** Pontos de fixação da suspensão (m, eixos locais do chassi) */
	private readonly connectionPoints: THREE.Vector3[] = [];
	private readonly hits: RaycastHit[] = [];
	/** Forças de suspensão do último passo valem para o estado atual (falso após escrever o estado do chassi) */
	private wheelLoadsValid = false;
	private tempVector3 = new THREE.Vector3();
	private tempVelocity = new THREE.Vector3();
	private tempQuaternion = new THREE.Quaternion();
	private tempRight = new THREE.Vector3();
	private tempImpulse = new THREE.Vector3();
	private tempPosition = new THREE.Vector3();
	private tempHardPoint = new THREE.Vector3();
	private tempDirection = new THREE.Vector3();
	private tempPointVelocity = new THREE.Vector3();
	private tempGroundVelocity = new THREE.Vector3();
	private previousVelocity = new THREE.Vector3();
	private hasPreviousVelocity = false;

	static readonly LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
	static readonly LOCAL_DOWN = new THREE.Vector3(0, -1, 0);
	static readonly LOCAL_RIGHT = new THREE.Vector3(0, 0, 1);

	constructor(
		private readonly physicsWorld: PhysicsWorld,
		private readonly definition: VehicleDefinition,
	) {
		const physicsData = definition.physics;
		const chassisSize = physicsData.size;
		this.suspensionRestLength = physicsData.suspensionRestLength;
		this.suspension = new Suspension(
			definition.suspension,
			physicsData.suspensionRestLength,
			definition.wheels.adjustments.length,
		);

		this.chassisBody = physicsWorld.createRigidBody({
			type: "dynamic",
			position: { x: 0, y: 1, z: 3 },
			linearDamping: 0.01,
			angularDamping: 0.01,
			canSleep: false,
			ccdEnabled: true,
		});

		physicsWorld.createCollider(
			{
				shape: "cuboid",
				halfExtents: {
					x: chassisSize.x / 2,
					y: chassisSize.y / 2,
					z: chassisSize.z / 2,
				},
				friction: 0.5,
				restitution: 0.1,
				density: physicsData.mass / (chassisSize.x * chassisSize.y * chassisSize.z),
			},
			this.chassisBody,
		);

		this.controller = physicsWorld.createVehicleController(this.chassisBody);
		this.addWheels();
	}

	private addWheels(): void {
		const physicsData = this.definition.physics;
		// o controlador usa +X como frente (indexForwardAxis = 0) e +Y como cima
		const down = VehiclePhysics.LOCAL_DOWN;
		const axle = VehiclePhysics.LOCAL_RIGHT;

		this.definition.wheels.adjustments.forEach((wheel) => {
			this.controller.addWheel({
				connectionPoint: wheel.position,
				direction: down,
				axle,
				suspensionRestLength: physicsData.suspensionRestLength,
				radius: physicsData.wheelRadius,
				frictionSlip: wheel.frictionSlip ?? physicsData.frictionSlip,
				sideFrictionStiffness: wheel.sideFrictionStiffness ?? physicsData.sideFrictionStiffness,
			});
			this.connectionPoints.push(new THREE.Vector3(wheel.position.x, wheel.position.y, wheel.position.z));
			this.hits.push(createRaycastHit());

			this.wheels.push({
				previousSuspensionLength: physicsData.suspensionRestLength,
				previousSteering: 0,
				previousRotation: 0,
			});
			this.telemetry.wheels.push(createWheelTelemetry(physicsData.suspensionRestLength));
		});
	}

	/** Guarda os valores das rodas antes do passo (início do pré-passo) */
	savePreviousWheelStates(): void {
		for (let i = 0; i < this.wheels.length; i++) {
			const wheel = this.wheels[i];
			wheel.previousSuspensionLength = this.wheelSuspensionLength(i);
			wheel.previousSteering = this.wheelSteering(i);
			wheel.previousRotation = this.wheelRotation(i);
		}
	}

	/**
	 * Aplica os comandos ao controlador (rodas 0/1 dianteiras, 2/3 traseiras) e o arrasto ao chassi
	 * @param dt passo de física (s): freio e arrasto viram impulso por passo (N·s)
	 */
	applyCommands(commands: VehicleCommands, dt: number): void {
		this.controller.setWheelSteering(0, commands.steeringAngle);
		this.controller.setWheelSteering(1, commands.steeringAngle);
		this.applyEngineForce(commands.engineForce);
		this.applyBraking(commands.brakeForce * dt, commands.handbrakeForce * dt);
		this.applyAerodynamicDrag(dt);
	}

	/** Arrasto aerodinâmico oposto à velocidade do chassi, como impulso no centro de massa (N·s) */
	private applyAerodynamicDrag(dt: number): void {
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.applyImpulse(
			aerodynamicDragImpulse(this.definition.aerodynamics, velocity, dt, this.tempImpulse),
		);
	}

	/** Suspensão e depois o controlador (pneus); chamar no pré-passo, antes de `world.step()` */
	updateVehicle(dt: number): void {
		this.updateSuspension(dt);
		this.controller.updateVehicle(dt);
		this.wheelLoadsValid = true;
	}

	/**
	 * Mede cada roda com um raio da fixação ao longo da suspensão (ignorando o chassi), calcula as forças e as aplica
	 * como impulso (N·s) ao longo da normal, no ponto de contato (como o controlador); a carga vai ao controlador para o atrito.
	 * Velocidade de compressão = velocidade relativa ao longo da normal / cos(normal, suspensão): deslizar sobre o chão
	 * não comprime; com a suspensão quase paralela ao chão (cos > −0,1) é zero.
	 */
	private updateSuspension(dt: number): void {
		const chassis = this.chassisBody;
		const position = chassis.getPosition(this.tempPosition);
		const rotation = chassis.getRotation(this.tempQuaternion);
		const direction = this.tempDirection.copy(VehiclePhysics.LOCAL_DOWN).applyQuaternion(rotation);
		const radius = this.definition.physics.wheelRadius;
		const rayLength = this.suspensionRestLength + radius;

		for (let i = 0; i < this.connectionPoints.length; i++) {
			const hardPoint = this.tempHardPoint.copy(this.connectionPoints[i]).applyQuaternion(rotation).add(position);
			const hit = this.hits[i];
			if (this.physicsWorld.castRayWithNormal(hardPoint, direction, rayLength, hit, chassis)) {
				const velocity = chassis.getVelocityAtPoint(hardPoint, this.tempPointVelocity);
				if (hit.body) {
					const ground = hit.body.getVelocityAtPoint(hit.point, this.tempGroundVelocity);
					velocity.sub(ground);
				}
				const normal = hit.normal;
				const normalDotDirection = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
				const normalSpeed = normal.x * velocity.x + normal.y * velocity.y + normal.z * velocity.z;
				const compressionRate = normalDotDirection < -0.1 ? normalSpeed / normalDotDirection : 0;
				this.suspension.setContact(i, true, hit.distance - radius, compressionRate);
			} else {
				this.suspension.setContact(i, false, this.suspensionRestLength, 0);
			}
		}

		this.suspension.computeForces();

		for (let i = 0; i < this.connectionPoints.length; i++) {
			const wheel = this.suspension.wheels[i];
			if (!wheel.inContact) {
				this.controller.setWheelTireLoad(i, 0, this.suspensionRestLength, -1);
				continue;
			}
			const hit = this.hits[i];
			const normal = hit.normal;
			const impulse = wheel.force * dt;
			this.tempImpulse.set(normal.x * impulse, normal.y * impulse, normal.z * impulse);
			chassis.applyImpulseAtPoint(this.tempImpulse, hit.point);
			const normalDotDirection = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
			this.controller.setWheelTireLoad(i, wheel.force, wheel.length, normalDotDirection);
		}
	}

	/** Força do motor por roda motriz (N) conforme a tração */
	private applyEngineForce(force: number): void {
		const front = this.definition.configs.tractionDisplacement === "rear" ? 0 : force;
		const rear = this.definition.configs.tractionDisplacement === "front" ? 0 : force;
		this.setTractionForce(0, front);
		this.setTractionForce(1, front);
		this.setTractionForce(2, rear);
		this.setTractionForce(3, rear);
	}

	/**
	 * Força do motor limitada ao atrito longitudinal (tractionFriction × carga normal do último passo, N):
	 * em linha reta o controlador da Rapier não limita o impulso do motor.
	 * Sem limite no passo seguinte a uma escrita de estado, para o replay não depender do passo anterior.
	 */
	private setTractionForce(index: number, force: number): void {
		if (!this.wheelLoadsValid) {
			this.controller.setWheelEngineForce(index, force);
			return;
		}
		const normalLoad = this.suspension.wheels[index].force;
		const limit = this.definition.physics.tractionFriction * normalLoad;
		this.controller.setWheelEngineForce(index, Math.max(-limit, Math.min(limit, force)));
	}

	/** Impulsos de freio por passo (N·s por roda); o freio de mão substitui o freio nas traseiras */
	private applyBraking(normalBrake: number, handBrake: number): void {
		const rearBrake = handBrake > 0 ? handBrake : normalBrake;
		this.controller.setWheelBrake(2, rearBrake);
		this.controller.setWheelBrake(3, rearBrake);
		this.controller.setWheelBrake(0, normalBrake);
		this.controller.setWheelBrake(1, normalBrake);
	}

	/**
	 * Atualiza a telemetria com o resultado do último passo; chamar no início do pré-passo
	 * @param dt passo de física (s)
	 * @param state estado do veículo no último passo (rotação e marcha)
	 */
	updateTelemetry(dt: number, state: Readonly<VehicleState>): void {
		const telemetry = this.telemetry;
		telemetry.engineRpm = state.engineRpm;
		telemetry.gear = state.gear;
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.getRotation(this.tempQuaternion);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		const right = this.tempRight.copy(VehiclePhysics.LOCAL_RIGHT).applyQuaternion(this.tempQuaternion);

		telemetry.timeStep = dt;
		telemetry.speed = velocity.length();
		telemetry.forwardSpeed = velocity.dot(forward);
		telemetry.lateralSpeed = velocity.dot(right);

		if (this.hasPreviousVelocity && dt > 0) {
			const previous = this.previousVelocity;
			const ax = (velocity.x - previous.x) / dt;
			const ay = (velocity.y - previous.y) / dt;
			const az = (velocity.z - previous.z) / dt;
			telemetry.longitudinalAccelerationG = (ax * forward.x + ay * forward.y + az * forward.z) / STANDARD_GRAVITY;
			telemetry.lateralAccelerationG = (ax * right.x + ay * right.y + az * right.z) / STANDARD_GRAVITY;
		} else {
			telemetry.longitudinalAccelerationG = 0;
			telemetry.lateralAccelerationG = 0;
		}
		this.previousVelocity.copy(velocity);
		this.hasPreviousVelocity = true;

		telemetry.steeringAngle = this.wheelSteering(0);
		for (let i = 0; i < telemetry.wheels.length; i++) {
			const wheel = telemetry.wheels[i];
			const suspension = this.suspension.wheels[i];
			wheel.inContact = suspension.inContact;
			wheel.suspensionLength = suspension.length;
			wheel.compression = suspension.compression;
			wheel.suspensionForce = suspension.force;
			wheel.forwardImpulse = this.controller.wheelForwardImpulse(i) ?? 0;
			wheel.sideImpulse = this.controller.wheelSideImpulse(i) ?? 0;
			wheel.steering = this.wheelSteering(i);
		}
	}

	/** Velocidade do chassi ao longo de +X local (m/s; negativa em ré) */
	forwardSpeed(): number {
		const velocity = this.chassisBody.getLinearVelocity(this.tempVelocity);
		this.chassisBody.getRotation(this.tempQuaternion);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		return velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
	}

	/** Comprimento atual da suspensão (m) */
	wheelSuspensionLength(index: number): number {
		return this.suspension.wheels[index]?.length ?? this.suspensionRestLength;
	}

	/** Esterço atual (rad) */
	wheelSteering(index: number): number {
		return this.controller.wheelSteering(index) ?? 0;
	}

	/** Giro acumulado (rad) */
	wheelRotation(index: number): number {
		return this.controller.wheelRotation(index) ?? 0;
	}

	wheelIsInContact(index: number): boolean {
		return this.suspension.wheels[index]?.inContact ?? false;
	}

	/** Teleporta 1 m acima, nivelado e parado */
	reset(): void {
		const currentPos = this.chassisBody.getPosition(this.tempVector3);
		this.chassisBody.setPosition({ x: currentPos.x, y: currentPos.y + 1, z: currentPos.z });
		this.chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 });
		this.chassisBody.setLinearVelocity({ x: 0, y: 0, z: 0 });
		this.chassisBody.setAngularVelocity({ x: 0, y: 0, z: 0 });
		this.physicsWorld.resetInterpolation(this.chassisBody);
		this.hasPreviousVelocity = false;
		this.wheelLoadsValid = false;
	}

	captureChassisState<T extends ChassisState>(out: T): T {
		this.chassisBody.getPosition(out.position);
		this.chassisBody.getRotation(out.rotation);
		this.chassisBody.getLinearVelocity(out.linearVelocity);
		this.chassisBody.getAngularVelocity(out.angularVelocity);
		return out;
	}

	/** Escreve o estado no chassi; o motor pode normalizar a rotação, então aplicar o mesmo estado dá o mesmo resultado */
	applyChassisState(state: Readonly<ChassisState>): void {
		this.chassisBody.setPosition(state.position);
		this.chassisBody.setRotation(state.rotation);
		this.chassisBody.setLinearVelocity(state.linearVelocity);
		this.chassisBody.setAngularVelocity(state.angularVelocity);
		this.wheelLoadsValid = false;
	}

	/** Teleporta o chassi para o estado dado, sem interpolar a partir da pose anterior */
	restoreChassisState(state: Readonly<ChassisState>): void {
		this.applyChassisState(state);
		this.physicsWorld.resetInterpolation(this.chassisBody);
		this.hasPreviousVelocity = false;
	}

	/** Remove o controlador e o chassi (corpo e colisor) do mundo */
	destroy(): void {
		this.physicsWorld.removeVehicleController(this.controller);
		this.physicsWorld.removeRigidBody(this.chassisBody);
	}
}
