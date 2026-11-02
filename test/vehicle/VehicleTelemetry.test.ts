import { describe, expect, it, vi } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { STANDARD_GRAVITY } from "../../src/vehicle/VehicleTelemetry";
import { createRapierSim, RapierSimHandle } from "../support/rapierSim";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		clearCache(): void {}
	},
}));

const FRAME_DT = 1 / 60;
const WORLD_GRAVITY = 9.82;

function run(sim: RapierSimHandle, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / FRAME_DT); i++) sim.frame(FRAME_DT);
}

describe.each(["bmw_f82", "mercedes_g63"])("telemetria — %s", (vehicleId) => {
	it("em repouso as suspensões sustentam o peso e não há aceleração", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		const t = sim.player.getTelemetry();
		const mass = getVehicleDefinition(vehicleId)!.physics.mass;

		const totalSuspensionForce = t.wheels.reduce((sum, w) => sum + w.suspensionForce, 0);
		expect(t.wheels).toHaveLength(4);
		expect(t.wheels.every((w) => w.inContact && w.compression > 0)).toBe(true);
		expect(totalSuspensionForce / (mass * WORLD_GRAVITY)).toBeCloseTo(1, 2);
		expect(Math.abs(t.longitudinalAccelerationG)).toBeLessThan(0.01);
		expect(Math.abs(t.lateralAccelerationG)).toBeLessThan(0.01);
		expect(t.timeStep).toBeCloseTo(1 / 60, 10);
	});

	it("acelerando: aceleração longitudinal igual à força de tração sobre a massa", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		sim.input.throttle = true;
		run(sim, 2);
		const t = sim.player.getTelemetry();
		const mass = getVehicleDefinition(vehicleId)!.physics.mass;

		const tractionForce = t.wheels.reduce((sum, w) => sum + w.forwardImpulse, 0) / t.timeStep;
		const expectedG = tractionForce / mass / STANDARD_GRAVITY;
		expect(t.longitudinalAccelerationG).toBeGreaterThan(0.3);
		expect(Math.abs(t.longitudinalAccelerationG - expectedG)).toBeLessThan(0.05);
		expect(Math.abs(t.lateralAccelerationG)).toBeLessThan(0.01);
		expect(t.forwardSpeed).toBeGreaterThan(5);
		expect(t.speed).toBeCloseTo(Math.hypot(t.forwardSpeed, t.lateralSpeed), 1);
	});

	it("curva à direita: aceleração lateral positiva (+Z), esterço negativo e impulsos laterais positivos", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		sim.input.throttle = true;
		run(sim, 2);
		sim.input.right = true;
		run(sim, 1.5);
		const t = sim.player.getTelemetry();

		expect(t.steeringAngle).toBeLessThan(0);
		expect(t.lateralAccelerationG).toBeGreaterThan(0.3);
		expect(t.wheels.every((w) => w.sideImpulse > 0)).toBe(true);
		expect(t.wheels[0].compression).toBeGreaterThan(t.wheels[1].compression);
	});

	it("freando: aceleração longitudinal negativa e transferência de carga para a frente", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		sim.input.throttle = true;
		run(sim, 3);
		sim.input.throttle = false;
		sim.input.brake = true;
		run(sim, 0.5);
		const t = sim.player.getTelemetry();

		expect(t.longitudinalAccelerationG).toBeLessThan(-0.5);
		expect(t.wheels[0].suspensionForce).toBeGreaterThan(t.wheels[2].suspensionForce);
		expect(t.wheels.every((w) => w.forwardImpulse < 0)).toBe(true);
	});

	it("reset não gera pico de aceleração", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		sim.input.throttle = true;
		run(sim, 3);
		sim.input.throttle = false;
		sim.player.resetCar();
		sim.frame(FRAME_DT);
		const t = sim.player.getTelemetry();

		expect(t.longitudinalAccelerationG).toBe(0);
		expect(t.lateralAccelerationG).toBe(0);
	});
});
