import * as THREE from "three";
import { VehicleDefinition } from "../../src/data/vehicles/types";
import { PhysicsWorld } from "../../src/physics/PhysicsWorld";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";
import VehicleControl from "../../src/vehicle/VehicleControl";
import VehiclePhysics from "../../src/vehicle/VehiclePhysics";
import { createVehicleState } from "../../src/vehicle/VehicleState";
import { DriveInput, ScriptedInput, SimHandle, VehicleSnapshot } from "./sim";

/**
 * Veículo montado a partir de uma `VehicleDefinition` qualquer (ex.: catálogo com parâmetros alterados),
 * sem Player nem VehicleView: mesmo pré-passo do Player (telemetria → controle → física) sobre um plano.
 */
export interface VehicleRig extends SimHandle {
	readonly input: DriveInput;
	readonly physics: VehiclePhysics;
	readonly physicsWorld: PhysicsWorld;
	/** Avança `steps` passos fixos, chamando `onStep` depois de cada um */
	steps(count: number, onStep?: () => void): void;
	dispose(): void;
}

export async function createVehicleRig(
	definition: VehicleDefinition,
	fixedTimeStep = 1 / 60,
	groundHalfSize = 1000,
): Promise<VehicleRig> {
	const physicsWorld: PhysicsWorld = await RapierPhysicsWorld.create(new THREE.Scene(), fixedTimeStep);
	const ground = physicsWorld.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
	physicsWorld.createGroundCollider(ground, 0.8, groundHalfSize);

	const scripted = new ScriptedInput();
	const state = createVehicleState(definition.powertrain.idleRpm);
	const control = new VehicleControl(definition, state);
	const physics = new VehiclePhysics(physicsWorld, definition);
	physicsWorld.addPreStepCallback((dt) => {
		physics.updateTelemetry(dt, state);
		physics.savePreviousWheelStates();
		physics.applyCommands(control.step(scripted, physics.forwardSpeed(), dt, physics.drivenWheelSpeed()), dt);
		physics.updateVehicle(dt);
	});

	return {
		input: scripted.state,
		analog: scripted.analog,
		physics,
		physicsWorld,
		frame(deltaTime: number): void {
			physicsWorld.update(deltaTime);
		},
		steps(count: number, onStep?: () => void): void {
			for (let i = 0; i < count; i++) {
				physicsWorld.update(fixedTimeStep);
				onStep?.();
			}
		},
		snapshot(): VehicleSnapshot {
			const body = physics.chassisBody;
			return {
				position: body.getPosition({ x: 0, y: 0, z: 0 }),
				velocity: body.getLinearVelocity({ x: 0, y: 0, z: 0 }),
				quaternion: body.getRotation({ x: 0, y: 0, z: 0, w: 1 }),
				hudSpeed: physics.forwardSpeed() * 3.6,
			};
		},
		dispose(): void {
			physics.destroy();
			physicsWorld.dispose();
		},
	};
}

/** Cópia profunda e mutável de uma definição, para testes que alteram parâmetros */
export function cloneDefinition(definition: VehicleDefinition): VehicleDefinition {
	return structuredClone(definition);
}
