import { describe, expect, it } from "vitest";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { DifferentialConfig, VehicleDefinition } from "../../src/data/vehicles/types";
import { NEUTRAL_GEAR } from "../../src/vehicle/VehicleState";
import { SETTLE_TIME } from "../support/scenarios";
import { cloneDefinition, createVehicleRig, VehicleRig } from "../support/vehicleRig";

/**
 * Trem de força acoplado às rodas (ADR-0003, etapa 4) no veículo sobre o harness: freio-motor, autoblocante,
 * diferencial central e estabilidade da rotação do motor.
 */

const FRAME_DT = 1 / 60; // s
const OPEN: DifferentialConfig = {
	torqueSplit: 0.5,
	preloadTorque: 0,
	powerLocking: 0,
	coastLocking: 0,
	viscousCoupling: 0,
};
/** Escorregamento médio das dianteiras do G63 no 0–100 da etapa 3 (diferenciais abertos provisórios, medido) */
const STAGE_3_G63_FRONT_SLIP = 0.674;

function seconds(value: number): number {
	return Math.round(value / FRAME_DT);
}

async function settledRig(definition: VehicleDefinition): Promise<VehicleRig> {
	const rig = await createVehicleRig(definition, FRAME_DT);
	rig.steps(seconds(SETTLE_TIME));
	return rig;
}

function accelerateTo(rig: VehicleRig, kmh: number): void {
	rig.input.throttle = true;
	while (rig.physics.forwardSpeed() * 3.6 < kmh) rig.steps(1);
	rig.input.throttle = false;
}

describe.each(["bmw_f82", "mercedes_g63"])("veículo %s — trem de força acoplado", (vehicleId) => {
	const definition = getVehicleDefinition(vehicleId)!;
	const powertrain = definition.powertrain;

	it("freio-motor: sem pedais, em marcha desacelera mensuravelmente mais que em ponto morto", async () => {
		const coast = async (neutral: boolean) => {
			const rig = await settledRig(definition);
			accelerateTo(rig, 80);
			if (neutral) rig.state.gear = NEUTRAL_GEAR;
			rig.steps(seconds(0.5));
			const before = rig.physics.forwardSpeed();
			rig.steps(seconds(2));
			const deceleration = (before - rig.physics.forwardSpeed()) / 2;
			const gear = rig.state.gear;
			rig.dispose();
			return { deceleration, gear };
		};
		const inGear = await coast(false);
		const inNeutral = await coast(true);

		expect(inNeutral.gear).toBe(NEUTRAL_GEAR);
		expect(inGear.gear).toBeGreaterThan(0);
		expect(inGear.deceleration - inNeutral.deceleration).toBeGreaterThan(0.3);
	});

	it("desaceleração sem pedais até parar: reduz uma marcha por vez, rotação entre a lenta e o corte", async () => {
		const rig = await settledRig(definition);
		accelerateTo(rig, 120);
		let gear = rig.state.gear;
		let minRpm = Infinity;
		let maxRpm = -Infinity;
		rig.steps(seconds(60), () => {
			expect(gear - rig.state.gear).toBeLessThanOrEqual(1);
			expect(rig.state.gear).toBeLessThanOrEqual(gear);
			gear = rig.state.gear;
			minRpm = Math.min(minRpm, rig.physics.engineRpm());
			maxRpm = Math.max(maxRpm, rig.physics.engineRpm());
		});

		expect(gear).toBe(1);
		expect(rig.physics.forwardSpeed()).toBeLessThan(3);
		expect(minRpm).toBeGreaterThanOrEqual(powertrain.idleRpm);
		expect(maxRpm).toBeLessThanOrEqual(powertrain.revLimitRpm);
		rig.dispose();
	});

	it("parado sem pedais: rotação na lenta, sem oscilar", async () => {
		const rig = await settledRig(definition);
		rig.steps(seconds(2));
		let previous = rig.physics.engineRpm();
		let maxStep = 0;
		rig.steps(seconds(2), () => {
			const rpm = rig.physics.engineRpm();
			maxStep = Math.max(maxStep, Math.abs(rpm - previous));
			previous = rpm;
		});

		expect(previous).toBeGreaterThanOrEqual(powertrain.idleRpm);
		expect(previous).toBeLessThan(powertrain.idleRpm + 25);
		expect(maxStep).toBeLessThan(0.01);
		expect(rig.physics.telemetry.clutchLocked).toBe(false);
		rig.dispose();
	});
});

describe("autoblocante traseiro do BMW", () => {
	/** Curva com acelerador parcial: média de |ω esquerda − ω direita| das traseiras (rad/s) e do giro do chassi */
	async function powerTurn(definition: VehicleDefinition) {
		const rig = await settledRig(definition);
		accelerateTo(rig, 40);
		rig.analog.throttle = 0.35;
		rig.analog.steer = -0.3;
		let difference = 0;
		let yawRate = 0;
		const frames = seconds(2);
		rig.steps(frames, () => {
			const wheels = rig.physics.telemetry.wheels;
			difference += Math.abs(wheels[2].angularVelocity - wheels[3].angularVelocity) / frames;
			yawRate += rig.physics.chassisBody.getAngularVelocity({ x: 0, y: 0, z: 0 }).y / frames;
		});
		const speed = rig.physics.forwardSpeed();
		rig.dispose();
		return { difference, yawRate, speed };
	}

	it("reduz a diferença de rotação entre as rodas traseiras em curva com acelerador, contra o aberto", async () => {
		const open = cloneDefinition(getVehicleDefinition("bmw_f82")!);
		open.powertrain.differentials.rear = OPEN;
		const withLsd = await powerTurn(getVehicleDefinition("bmw_f82")!);
		const withOpen = await powerTurn(open);

		expect(withOpen.speed).toBeGreaterThan(5);
		expect(withLsd.speed).toBeGreaterThan(5);
		expect(withLsd.difference).toBeLessThan(0.5 * withOpen.difference);
	});
});

describe("diferencial central do G63", () => {
	async function launch(definition: VehicleDefinition) {
		const rig = await settledRig(definition);
		rig.input.throttle = true;
		let frontSlip = 0;
		let frames = 0;
		while (rig.physics.forwardSpeed() * 3.6 < 100 && frames < seconds(15)) {
			rig.steps(1);
			const wheels = rig.physics.telemetry.wheels;
			frontSlip += (Math.abs(wheels[0].slipRatio) + Math.abs(wheels[1].slipRatio)) / 2;
			frames++;
		}
		rig.dispose();
		return { frontSlip: frontSlip / frames, time: frames * FRAME_DT };
	}

	it("40/60 com bloqueio: dianteiras patinam menos na saída que na etapa 3 e que com o central livre", async () => {
		const free = cloneDefinition(getVehicleDefinition("mercedes_g63")!);
		free.powertrain.differentials.center = { ...OPEN, torqueSplit: 0.4 };
		const locked = await launch(getVehicleDefinition("mercedes_g63")!);
		const open = await launch(free);

		expect(locked.frontSlip).toBeLessThan(STAGE_3_G63_FRONT_SLIP);
		expect(locked.frontSlip).toBeLessThan(0.5 * open.frontSlip);
		expect(locked.time).toBeLessThan(open.time);
	});
});
