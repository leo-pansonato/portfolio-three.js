import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { VehicleDefinition } from "../data/vehicles/types";
import PhysicsManager from "../managers/PhysicsManager";
import { VehicleCommands } from "./VehicleControl";

/** Valores de uma roda no passo anterior, para a interpolação visual */
export interface WheelStepState {
	/** Comprimento da suspensão (m) */
	previousSuspensionLength: number;
	/** Esterço (rad) */
	previousSteering: number;
	/** Giro acumulado (rad) */
	previousRotation: number;
}

/**
 * Física de um veículo: chassi (corpo dinâmico + cuboid) e DynamicRayCastVehicleController.
 * Dono desses objetos do motor; `destroy()` os remove do mundo.
 * Eixos do chassi (ADR-0002): frente +X, cima +Y, direita +Z; THREE só para matemática.
 */
export default class VehiclePhysics {
	readonly chassisBody: RAPIER.RigidBody;
	readonly chassisCollider: RAPIER.Collider;
	readonly controller: RAPIER.DynamicRayCastVehicleController;
	readonly wheels: WheelStepState[] = [];

	private readonly suspensionRestLength: number;
	private tempVector3 = new THREE.Vector3();
	private tempQuaternion = new THREE.Quaternion();

	static readonly LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
	static readonly LOCAL_DOWN = new THREE.Vector3(0, -1, 0);
	static readonly LOCAL_RIGHT = new THREE.Vector3(0, 0, 1);

	constructor(
		private readonly physicsManager: PhysicsManager,
		private readonly definition: VehicleDefinition
	) {
		const physicsData = definition.physics;
		const chassisSize = physicsData.size;
		this.suspensionRestLength = physicsData.suspensionRestLength;

		this.chassisBody = physicsManager.createRigidBody({
			type: "dynamic",
			position: { x: 0, y: 1, z: 3 },
			linearDamping: 0.01,
			angularDamping: 0.01,
			canSleep: false,
			ccdEnabled: true,
		});

		this.chassisCollider = physicsManager.createCollider(
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
			this.chassisBody
		);

		this.controller = physicsManager.world.createVehicleController(this.chassisBody);
		this.addWheels();
	}

	private addWheels(): void {
		const physicsData = this.definition.physics;
		const Rapier = this.physicsManager.getRapier();
		// o controlador usa +X como frente (indexForwardAxis = 0) e +Y como cima
		const down = VehiclePhysics.LOCAL_DOWN;
		const axle = VehiclePhysics.LOCAL_RIGHT;

		this.definition.wheels.adjustments.forEach((wheel, i) => {
			this.controller.addWheel(
				new Rapier.Vector3(wheel.position.x, wheel.position.y, wheel.position.z),
				new Rapier.Vector3(down.x, down.y, down.z),
				new Rapier.Vector3(axle.x, axle.y, axle.z),
				physicsData.suspensionRestLength,
				physicsData.wheelRadius
			);

			this.controller.setWheelSuspensionStiffness(i, physicsData.suspensionStiffness);
			this.controller.setWheelMaxSuspensionTravel(i, physicsData.maxSuspensionTravel);
			this.controller.setWheelMaxSuspensionForce(i, physicsData.maxSuspensionForce);
			this.controller.setWheelSuspensionCompression(i, physicsData.suspensionCompression);
			this.controller.setWheelSuspensionRelaxation(i, physicsData.suspensionRelaxation);
			this.controller.setWheelFrictionSlip(i, wheel.frictionSlip ?? physicsData.frictionSlip);
			this.controller.setWheelSideFrictionStiffness(i, wheel.sideFrictionStiffness ?? physicsData.sideFrictionStiffness);

			this.wheels.push({
				previousSuspensionLength: physicsData.suspensionRestLength,
				previousSteering: 0,
				previousRotation: 0,
			});
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
	 * Aplica os comandos ao controlador (rodas 0/1 dianteiras, 2/3 traseiras)
	 * @param dt passo de física (s): o freio vira impulso máximo por passo (N·s)
	 */
	applyCommands(commands: VehicleCommands, dt: number): void {
		this.controller.setWheelSteering(0, commands.steeringAngle);
		this.controller.setWheelSteering(1, commands.steeringAngle);
		this.applyEngineForce(commands.engineForce);
		this.applyBraking(commands.brakeForce * dt, commands.handbrakeForce * dt);
	}

	/** Atualiza o controlador; chamar no pré-passo, antes de `world.step()` */
	updateVehicle(dt: number): void {
		this.controller.updateVehicle(dt);
	}

	/** Força do motor por roda motriz (N) conforme a tração */
	private applyEngineForce(force: number): void {
		const front = this.definition.configs.tractionDisplacement === "rear" ? 0 : force;
		const rear = this.definition.configs.tractionDisplacement === "front" ? 0 : force;
		this.controller.setWheelEngineForce(0, front);
		this.controller.setWheelEngineForce(1, front);
		this.controller.setWheelEngineForce(2, rear);
		this.controller.setWheelEngineForce(3, rear);
	}

	/** Impulsos de freio por passo (N·s por roda); o freio de mão substitui o freio nas traseiras */
	private applyBraking(normalBrake: number, handBrake: number): void {
		const rearBrake = handBrake > 0 ? handBrake : normalBrake;
		this.controller.setWheelBrake(2, rearBrake);
		this.controller.setWheelBrake(3, rearBrake);
		this.controller.setWheelBrake(0, normalBrake);
		this.controller.setWheelBrake(1, normalBrake);
	}

	/** Velocidade do chassi ao longo de +X local (m/s; negativa em ré) */
	forwardSpeed(): number {
		const velocity = this.chassisBody.linvel();
		const chassisRot = this.chassisBody.rotation();
		this.tempQuaternion.set(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w);
		const forward = this.tempVector3.copy(VehiclePhysics.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		return velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
	}

	/** Comprimento atual da suspensão (m) */
	wheelSuspensionLength(index: number): number {
		return this.controller.wheelSuspensionLength(index) ?? this.suspensionRestLength;
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
		return this.controller.wheelIsInContact(index) ?? false;
	}

	/** Teleporta 1 m acima, nivelado e parado */
	reset(): void {
		const currentPos = this.chassisBody.translation();
		this.chassisBody.setTranslation({ x: currentPos.x, y: currentPos.y + 1, z: currentPos.z }, true);
		this.chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
		this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		this.physicsManager.resetInterpolation(this.chassisBody);
	}

	/** Remove o controlador e o chassi (corpo e colisor) do mundo */
	destroy(): void {
		this.physicsManager.world.removeVehicleController(this.controller);
		this.physicsManager.removeEntity(this.chassisBody);
	}
}
