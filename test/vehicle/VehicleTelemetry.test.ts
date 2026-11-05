import { describe, expect, it, vi } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { peakSlip } from "../../src/vehicle/Tire";
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

	it("pneus: escorregamento, rotação e força por roda coerentes com o impulso no passo", async () => {
		const sim = await createRapierSim(vehicleId);
		run(sim, 2);
		sim.input.throttle = true;
		run(sim, 1);
		const t = sim.player.getTelemetry();
		const definition = getVehicleDefinition(vehicleId)!;
		const radius = definition.physics.wheelRadius;
		const driven = definition.configs.tractionDisplacement === "all" ? [0, 1, 2, 3] : [2, 3];

		for (const [i, wheel] of t.wheels.entries()) {
			expect(wheel.longitudinalForce * t.timeStep).toBeCloseTo(wheel.forwardImpulse, 9);
			expect(wheel.lateralForce * t.timeStep).toBeCloseTo(wheel.sideImpulse, 9);
			expect(Math.abs(wheel.slipAngle)).toBeLessThan(0.01);
			if (driven.includes(i)) {
				expect(wheel.slipRatio).toBeGreaterThan(0);
				expect(wheel.longitudinalForce).toBeGreaterThan(0);
			} else {
				// roda livre: no início do passo fica atrás do chassi pelo que ele acelerou no passo anterior (a·dt/v)
				const lag = (t.longitudinalAccelerationG * STANDARD_GRAVITY * t.timeStep) / t.forwardSpeed;
				expect(Math.abs(wheel.slipRatio + lag)).toBeLessThan(0.005);
				expect(wheel.angularVelocity * radius).toBeCloseTo(t.forwardSpeed, 0);
			}
		}
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

	it("carga do motor: lenta parcial, plena acelerando, zero sem acelerador acima da lenta", async () => {
		const sim = await createRapierSim(vehicleId);
		const powertrain = getVehicleDefinition(vehicleId)!.powertrain;
		run(sim, 2);
		let t = sim.player.getTelemetry();
		expect(t.engineLoad).toBeGreaterThan(0);
		expect(t.engineLoad).toBeLessThan(0.2);
		expect(t.revLimiterActive).toBe(false);

		sim.input.throttle = true;
		run(sim, 0.25);
		t = sim.player.getTelemetry();
		expect(t.engineLoad).toBe(1);
		expect(t.engineRpm).toBeLessThan(powertrain.revLimitRpm - 200);

		run(sim, 3);
		sim.input.throttle = false;
		run(sim, 0.5);
		t = sim.player.getTelemetry();
		expect(t.engineRpm).toBeGreaterThan(powertrain.idleRpm + 500);
		expect(t.engineLoad).toBe(0);
		expect(t.revLimiterActive).toBe(false);
	});

	it("corte de giro: ré com acelerador pleno chega ao corte e reduz a carga", async () => {
		const sim = await createRapierSim(vehicleId);
		const powertrain = getVehicleDefinition(vehicleId)!.powertrain;
		run(sim, 2);
		sim.input.brake = true;
		run(sim, 8);
		const t = sim.player.getTelemetry();

		expect(t.gear).toBe(-1);
		expect(t.revLimiterActive).toBe(true);
		expect(t.engineRpm).toBeGreaterThan(powertrain.revLimitRpm - 200);
		expect(t.engineLoad).toBeLessThan(0.5);
	});

	it("escorregamento normalizado: zero parado, acima do pico nas motrizes na arrancada, combinação de κ e α", async () => {
		const sim = await createRapierSim(vehicleId);
		const definition = getVehicleDefinition(vehicleId)!;
		const peakRatio = peakSlip(definition.tire.longitudinal);
		const peakAngle = peakSlip(definition.tire.lateral);
		const driven = definition.configs.tractionDisplacement === "all" ? [0, 1, 2, 3] : [2, 3];
		run(sim, 2);
		let t = sim.player.getTelemetry();
		expect(t.wheels.every((w) => w.normalizedSlip < 0.01)).toBe(true);

		sim.input.throttle = true;
		run(sim, 0.25);
		t = sim.player.getTelemetry();
		for (const i of driven) expect(t.wheels[i].normalizedSlip).toBeGreaterThan(1);

		sim.input.right = true;
		run(sim, 1);
		t = sim.player.getTelemetry();
		for (const wheel of t.wheels) {
			const expected = Math.hypot(wheel.slipRatio / peakRatio, wheel.slipAngle / peakAngle);
			expect(wheel.normalizedSlip).toBeCloseTo(expected, 12);
		}
	});
});
