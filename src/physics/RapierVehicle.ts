import RAPIER from "@dimforge/rapier3d-compat";
import { RaycastVehicle, RaycastWheelConfig } from "./PhysicsWorld";

/** Menor compressão (m) usada para converter a carga em rigidez do controlador */
const MIN_LOAD_COMPRESSION = 1e-3;

/**
 * RaycastVehicle sobre o DynamicRayCastVehicleController da Rapier; o objeto WASM pertence ao RapierPhysicsWorld.
 *
 * Suspensão neutralizada: força máxima 0 (o controlador não aplica impulso de suspensão) e amortecimento 0.
 * O controlador limita o atrito por `forçaDeSuspensão × dt × frictionSlip`, com a força calculada (antes do limite
 * de força máxima) como `rigidez × massa × (repouso − comprimento) / cos`; setWheelTireLoad escolhe a rigidez
 * para essa força ser a carga normal da suspensão externa.
 */
export default class RapierVehicle implements RaycastVehicle {
	private readonly chassis: RAPIER.RigidBody;
	private readonly restLengths: number[] = [];

	constructor(readonly raw: RAPIER.DynamicRayCastVehicleController) {
		this.chassis = raw.chassis();
	}

	addWheel(config: RaycastWheelConfig): void {
		const i = this.raw.numWheels();
		const { connectionPoint: c, direction: d, axle: a } = config;
		this.raw.addWheel(
			new RAPIER.Vector3(c.x, c.y, c.z),
			new RAPIER.Vector3(d.x, d.y, d.z),
			new RAPIER.Vector3(a.x, a.y, a.z),
			config.suspensionRestLength,
			config.radius,
		);
		this.raw.setWheelSuspensionStiffness(i, 0);
		this.raw.setWheelMaxSuspensionTravel(i, config.suspensionRestLength);
		this.raw.setWheelMaxSuspensionForce(i, 0);
		this.raw.setWheelSuspensionCompression(i, 0);
		this.raw.setWheelSuspensionRelaxation(i, 0);
		this.raw.setWheelFrictionSlip(i, config.frictionSlip);
		this.raw.setWheelSideFrictionStiffness(i, config.sideFrictionStiffness);
		this.restLengths.push(config.suspensionRestLength);
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

	setWheelTireLoad(index: number, load: number, suspensionLength: number, contactNormalDotDirection: number): void {
		const compression = Math.max(MIN_LOAD_COMPRESSION, this.restLengths[index] - suspensionLength);
		const inverseCosine = contactNormalDotDirection >= -0.1 ? 10 : -1 / contactNormalDotDirection;
		const stiffness = Math.max(0, load) / (this.chassis.mass() * compression * inverseCosine);
		this.raw.setWheelSuspensionStiffness(index, stiffness);
	}

	updateVehicle(dt: number): void {
		this.raw.updateVehicle(dt);
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
