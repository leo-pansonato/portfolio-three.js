import { describe, expect, it } from "vitest";

import { computeVehicleSound, createVehicleSoundParams } from "../../src/audio/vehicleSound";
import { getVehicleDefinition } from "../../src/data/vehicles";
import { VehicleDefinition } from "../../src/data/vehicles/types";
import {
	STANDARD_GRAVITY,
	VehicleTelemetry,
	createVehicleTelemetry,
	createWheelTelemetry,
} from "../../src/vehicle/VehicleTelemetry";

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

describe("pneus, vento e rolamento", () => {
	const bmw = getVehicleDefinition("bmw_f82")!;
	const sound = (telemetry: VehicleTelemetry, definition = bmw) =>
		computeVehicleSound(telemetry, definition, createVehicleSoundParams());

	it("parado e rolando sem escorregar não há chiado; muito acima do pico em velocidade, satura", () => {
		const telemetry = telemetryFor(bmw);
		expect(sound(telemetry).tireGain).toBe(0);

		telemetry.speed = 20;
		for (const wheel of telemetry.wheels) wheel.normalizedSlip = 0.5;
		expect(sound(telemetry).tireGain).toBe(0);

		telemetry.wheels[2].normalizedSlip = 10;
		expect(sound(telemetry).tireGain).toBeCloseTo(1, 6);
	});

	it("escorregamento acima do pico chia proporcional ao excesso e some sem contato", () => {
		const telemetry = telemetryFor(bmw);
		telemetry.speed = 15;
		for (const wheel of telemetry.wheels) wheel.normalizedSlip = 1.3;
		const partial = sound(telemetry).tireGain;
		expect(partial).toBeGreaterThan(0.3);
		expect(partial).toBeLessThan(0.6);
		for (const wheel of telemetry.wheels) wheel.inContact = false;
		const airborne = sound(telemetry);
		expect(airborne.tireGain).toBe(0);
		expect(airborne.roadGain).toBe(0);
	});

	it("vento cresce com o quadrado da velocidade", () => {
		const telemetry = telemetryFor(bmw);
		telemetry.speed = 20;
		const slow = sound(telemetry).windGain;
		telemetry.speed = 40;
		expect(sound(telemetry).windGain).toBeCloseTo(slow * 4, 9);
	});
});
