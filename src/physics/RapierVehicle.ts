import RAPIER from "@dimforge/rapier3d-compat";
import { RaycastVehicle, RaycastWheelConfig } from "./PhysicsWorld";

/**
 * RaycastVehicle sobre o DynamicRayCastVehicleController da Rapier; o objeto WASM pertence ao RapierPhysicsWorld
 */
export default class RapierVehicle implements RaycastVehicle {
	constructor(readonly raw: RAPIER.DynamicRayCastVehicleController) {}

	addWheel(config: RaycastWheelConfig): void {
		const i = this.raw.numWheels();
		const { connectionPoint: c, direction: d, axle: a } = config;
		this.raw.addWheel(
			new RAPIER.Vector3(c.x, c.y, c.z),
			new RAPIER.Vector3(d.x, d.y, d.z),
			new RAPIER.Vector3(a.x, a.y, a.z),
			config.suspensionRestLength,
			config.radius
		);
		this.raw.setWheelSuspensionStiffness(i, config.suspensionStiffness);
		this.raw.setWheelMaxSuspensionTravel(i, config.maxSuspensionTravel);
		this.raw.setWheelMaxSuspensionForce(i, config.maxSuspensionForce);
		this.raw.setWheelSuspensionCompression(i, config.suspensionCompression);
		this.raw.setWheelSuspensionRelaxation(i, config.suspensionRelaxation);
		this.raw.setWheelFrictionSlip(i, config.frictionSlip);
		this.raw.setWheelSideFrictionStiffness(i, config.sideFrictionStiffness);
	}

	setWheelSteering(index: number, angle: number): void {
		this.raw.setWheelSteering(index, angle);
	}

	setWheelEngineForce(index: number, force: number): void {
		this.raw.setWheelEngineForce(index, force);
	}

	setWheelBrake(index: number, impulse: number): void {
		this.raw.setWheelBrake(index, impulse);
	}

	updateVehicle(dt: number): void {
		this.raw.updateVehicle(dt);
	}

	wheelSuspensionLength(index: number): number | null {
		return this.raw.wheelSuspensionLength(index);
	}

	wheelSteering(index: number): number | null {
		return this.raw.wheelSteering(index);
	}

	wheelRotation(index: number): number | null {
		return this.raw.wheelRotation(index);
	}

	wheelIsInContact(index: number): boolean | null {
		return this.raw.wheelIsInContact(index);
	}

	wheelSuspensionForce(index: number): number | null {
		return this.raw.wheelSuspensionForce(index);
	}

	wheelForwardImpulse(index: number): number | null {
		return this.raw.wheelForwardImpulse(index);
	}

	wheelSideImpulse(index: number): number | null {
		return this.raw.wheelSideImpulse(index);
	}
}
