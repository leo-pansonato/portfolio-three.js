import { describe, expect, it } from "vitest";
import { VEHICLE_DEFINITIONS } from "../../src/data/vehicles";
import { VehiclePowertrainConfig } from "../../src/data/vehicles/types";
import Powertrain, { PowertrainRequest } from "../../src/vehicle/Powertrain";
import { createVehicleState, REVERSE_GEAR } from "../../src/vehicle/VehicleState";

const DT = 1 / 60; // s
const WHEEL_RADIUS = 0.3; // m
const MASS = 1500; // kg
const RPM_PER_RAD_S = 60 / (2 * Math.PI);

const CONFIG: VehiclePowertrainConfig = Object.freeze({
	torqueCurve: [
		{ rpm: 1000, torque: 200 },
		{ rpm: 3000, torque: 400 },
		{ rpm: 6000, torque: 300 },
	],
	idleRpm: 800,
	revLimitRpm: 6500,
	upshiftRpm: 6000,
	downshiftRpm: 2500,
	gearRatios: [3, 2, 1.4, 1],
	reverseRatio: 3.2,
	finalDriveRatio: 4,
	efficiency: 0.9,
	engineInertia: 0, // kg·m²
	shiftTime: 0.2, // s
	topSpeed: 50, // m/s
	boostTorqueMultiplier: 1.5,
});

const FULL: PowertrainRequest = { throttle: 1, reverse: false, boost: false };

function setup(config: VehiclePowertrainConfig = CONFIG) {
	const state = createVehicleState(config.idleRpm);
	return { state, powertrain: new Powertrain(config, WHEEL_RADIUS, MASS, state) };
}

/** Velocidade (m/s) em que o motor gira a `rpm` na marcha dada */
function speedAt(rpm: number, gear: number): number {
	return ((rpm / RPM_PER_RAD_S) * WHEEL_RADIUS) / (CONFIG.gearRatios[gear - 1] * CONFIG.finalDriveRatio);
}

describe("Powertrain", () => {
	it("curva de torque interpolada e limitada às pontas", () => {
		const { powertrain } = setup();
		expect(powertrain.torqueAt(500)).toBe(200);
		expect(powertrain.torqueAt(2000)).toBe(300);
		expect(powertrain.torqueAt(4500)).toBe(350);
		expect(powertrain.torqueAt(9000)).toBe(300);
	});

	it("torque nas rodas = torque × relação × diferencial × eficiência", () => {
		const { state, powertrain } = setup();
		const speed = speedAt(3000, 1);
		const wheelTorque = powertrain.step(FULL, speed, DT);

		expect(state.gear).toBe(1);
		expect(state.engineRpm).toBeCloseTo(3000, 6);
		expect(wheelTorque).toBeCloseTo(400 * 3 * 4 * 0.9, 6);
	});

	it("parado: rotação na marcha lenta e torque da marcha lenta", () => {
		const { state, powertrain } = setup();
		const wheelTorque = powertrain.step(FULL, 0, DT);

		expect(state.engineRpm).toBe(CONFIG.idleRpm);
		expect(wheelTorque).toBeCloseTo(200 * 3 * 4 * 0.9, 6);
	});

	it("inércia do motor reduz o torque pela massa equivalente da marcha", () => {
		const { powertrain } = setup({ ...CONFIG, engineInertia: 0.2 });
		const ratio = 3 * 4;
		const equivalentMass = (0.2 * ratio * ratio * 0.9) / (WHEEL_RADIUS * WHEEL_RADIUS);
		const wheelTorque = powertrain.step(FULL, speedAt(3000, 1), DT);

		expect(wheelTorque).toBeCloseTo(400 * ratio * 0.9 * (MASS / (MASS + equivalentMass)), 6);
		expect(powertrain.inertiaFactor(4)).toBeGreaterThan(powertrain.inertiaFactor(ratio));
	});

	it("sobe de marcha no giro de troca, corta o torque durante a troca e não volta (histerese)", () => {
		const { state, powertrain } = setup();
		const speed = speedAt(6010, 1);

		expect(powertrain.step(FULL, speed, DT)).toBe(0);
		expect(state.gear).toBe(2);
		expect(state.engineRpm).toBeCloseTo((6010 * 2) / 3, 6);

		let steps = 1;
		while (powertrain.step(FULL, speed, DT) === 0) steps++;
		expect(steps * DT).toBeCloseTo(CONFIG.shiftTime, 6);

		for (let i = 0; i < 120; i++) powertrain.step(FULL, speed, DT);
		expect(state.gear).toBe(2);
	});

	it("desce de marcha abaixo do giro de redução, só se a marcha de baixo não passar do giro de troca", () => {
		const { state, powertrain } = setup();
		state.gear = 3;
		powertrain.step(FULL, speedAt(2400, 3), DT);
		expect(state.gear).toBe(2);

		// 2ª → 1ª levaria a 7.200 rpm: fica na 2ª
		const { state: other, powertrain: wideGaps } = setup({ ...CONFIG, gearRatios: [6, 2, 1.4, 1] });
		other.gear = 2;
		wideGaps.step(FULL, speedAt(2400, 2), DT);
		expect(other.gear).toBe(2);
	});

	it("corte de giro: sem torque a partir do limite", () => {
		const { state, powertrain } = setup({ ...CONFIG, topSpeed: 1000 });
		state.gear = 4;

		expect(powertrain.step(FULL, speedAt(6400, 4), DT)).toBeGreaterThan(0);
		expect(powertrain.step(FULL, speedAt(6500, 4), DT)).toBe(0);
		expect(state.engineRpm).toBeCloseTo(6500, 6);
	});

	it("limitador de velocidade zera o torque na velocidade máxima", () => {
		const { state, powertrain } = setup();
		state.gear = 4;
		expect(powertrain.step(FULL, CONFIG.topSpeed, DT)).toBe(0);
		expect(powertrain.step(FULL, CONFIG.topSpeed - 0.5, DT)).toBeGreaterThan(0);
	});

	it("ré com relação própria e torque negativo; boost multiplica o torque", () => {
		const { state, powertrain } = setup();
		const reverse = powertrain.step(
			{ throttle: 1, reverse: true, boost: false },
			-speedAt(3000, 1) * (3 / 3.2),
			DT,
		);

		expect(state.gear).toBe(REVERSE_GEAR);
		expect(state.engineRpm).toBeCloseTo(3000, 6);
		expect(reverse).toBeCloseTo(-400 * 3.2 * 4 * 0.9, 6);

		const boosted = powertrain.step({ throttle: 1, reverse: true, boost: true }, -speedAt(3000, 1) * (3 / 3.2), DT);
		expect(boosted).toBeCloseTo(reverse * CONFIG.boostTorqueMultiplier, 6);
		expect(state.boostMultiplier).toBe(CONFIG.boostTorqueMultiplier);

		powertrain.step(FULL, 0, DT);
		expect(state.gear).toBe(1);
	});
});

describe("catálogo — trem de força", () => {
	it.each(Object.entries(VEHICLE_DEFINITIONS))("%s: dados coerentes", (_id, definition) => {
		const p = definition.powertrain;
		expect(p.idleRpm).toBeLessThan(p.downshiftRpm);
		expect(p.downshiftRpm).toBeLessThan(p.upshiftRpm);
		expect(p.upshiftRpm).toBeLessThan(p.revLimitRpm);
		for (let i = 1; i < p.gearRatios.length; i++) expect(p.gearRatios[i]).toBeLessThan(p.gearRatios[i - 1]);
		for (let i = 1; i < p.torqueCurve.length; i++)
			expect(p.torqueCurve[i].rpm).toBeGreaterThan(p.torqueCurve[i - 1].rpm);
		expect(p.torqueCurve[0].rpm).toBeLessThanOrEqual(p.idleRpm);
		expect(p.efficiency).toBeGreaterThan(0.7);
		expect(p.efficiency).toBeLessThanOrEqual(1);
		expect(p.boostTorqueMultiplier).toBeGreaterThanOrEqual(1);
		expect(p.boostTorqueMultiplier).toBeLessThanOrEqual(1.5);
	});
});
