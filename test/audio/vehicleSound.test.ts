import { describe, expect, it } from "vitest";

import {
	computeVehicleSound,
	createVehicleSoundParams,
	impactIntensity,
	tirePeaks,
} from "../../src/audio/vehicleSound";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { VehicleDefinition } from "../../src/data/vehicles/types";
import { STANDARD_GRAVITY, createVehicleTelemetry, createWheelTelemetry } from "../../src/vehicle/VehicleTelemetry";

function telemetryFor(definition: VehicleDefinition) {
	const telemetry = createVehicleTelemetry();
	const staticLoad = (definition.physics.mass * STANDARD_GRAVITY) / 4;
	for (let i = 0; i < 4; i++) {
		const wheel = createWheelTelemetry(definition.physics.suspensionRestLength);
		wheel.inContact = true;
		wheel.suspensionForce = staticLoad;
		telemetry.wheels.push(wheel);
	}
	telemetry.engineRpm = definition.powertrain.idleRpm;
	return telemetry;
}

describe("som do veículo", () => {
	const bmw = getVehicleDefinition("bmw_f82")!;
	const g63 = getVehicleDefinition("mercedes_g63")!;
	const peaks = tirePeaks(bmw);

	it("ignição em rpm/60 · cilindros/2", () => {
		const telemetry = telemetryFor(bmw);
		telemetry.engineRpm = 6000;
		expect(computeVehicleSound(telemetry, 0, bmw, peaks, createVehicleSoundParams()).engineFrequencyHz).toBe(300);
		expect(
			computeVehicleSound(telemetry, 0, g63, tirePeaks(g63), createVehicleSoundParams()).engineFrequencyHz,
		).toBe(400);
	});

	it("motor fica mais alto e mais aberto com rotação e carga", () => {
		const telemetry = telemetryFor(bmw);
		const idle = { ...computeVehicleSound(telemetry, 0, bmw, peaks, createVehicleSoundParams()) };
		const loaded = { ...computeVehicleSound(telemetry, 1, bmw, peaks, createVehicleSoundParams()) };
		telemetry.engineRpm = bmw.powertrain.revLimitRpm;
		const limit = computeVehicleSound(telemetry, 1, bmw, peaks, createVehicleSoundParams());
		expect(idle.engineCutoffHz).toBe(bmw.sound.idleCutoffHz);
		expect(loaded.engineGain).toBeGreaterThan(idle.engineGain);
		expect(loaded.engineCutoffHz).toBeGreaterThan(idle.engineCutoffHz);
		expect(limit.engineGain).toBe(1);
		expect(limit.engineCutoffHz).toBe(bmw.sound.fullLoadCutoffHz);
	});

	it("parado e rolando sem escorregar não há chiado; travado em velocidade, há", () => {
		const telemetry = telemetryFor(bmw);
		const params = createVehicleSoundParams();
		expect(computeVehicleSound(telemetry, 0, bmw, peaks, params).tireGain).toBe(0);

		telemetry.speed = 20;
		for (const wheel of telemetry.wheels) wheel.slipRatio = peaks.longitudinal * 0.5;
		expect(computeVehicleSound(telemetry, 0, bmw, peaks, params).tireGain).toBe(0);

		telemetry.wheels[2].slipRatio = -1;
		expect(computeVehicleSound(telemetry, 0, bmw, peaks, params).tireGain).toBeCloseTo(1, 6);
	});

	it("deriva acima do pico chia proporcional ao excesso e some sem contato", () => {
		const telemetry = telemetryFor(bmw);
		const params = createVehicleSoundParams();
		telemetry.speed = 15;
		for (const wheel of telemetry.wheels) wheel.slipAngle = peaks.lateral * 1.3;
		const partial = computeVehicleSound(telemetry, 0, bmw, peaks, params).tireGain;
		expect(partial).toBeGreaterThan(0.3);
		expect(partial).toBeLessThan(0.6);
		for (const wheel of telemetry.wheels) wheel.inContact = false;
		const airborne = computeVehicleSound(telemetry, 0, bmw, peaks, params);
		expect(airborne.tireGain).toBe(0);
		expect(airborne.roadGain).toBe(0);
	});

	it("vento cresce com o quadrado da velocidade", () => {
		const telemetry = telemetryFor(bmw);
		const params = createVehicleSoundParams();
		telemetry.speed = 20;
		const slow = computeVehicleSound(telemetry, 0, bmw, peaks, params).windGain;
		telemetry.speed = 40;
		expect(computeVehicleSound(telemetry, 0, bmw, peaks, params).windGain).toBeCloseTo(slow * 4, 9);
	});

	it("impacto só acima do limiar de aceleração (frenagem e curva fortes não contam)", () => {
		const telemetry = telemetryFor(bmw);
		telemetry.longitudinalAccelerationG = -1.1;
		telemetry.lateralAccelerationG = 1.1;
		expect(impactIntensity(telemetry)).toBe(0);
		telemetry.longitudinalAccelerationG = -5;
		expect(impactIntensity(telemetry)).toBeGreaterThan(0);
		telemetry.longitudinalAccelerationG = -40;
		expect(impactIntensity(telemetry)).toBe(1);
	});
});
