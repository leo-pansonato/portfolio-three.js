import { describe, expect, it } from "vitest";
import { VEHICLE_DEFINITIONS } from "../../src/data/vehicles";
import { VehiclePowertrainConfig } from "../../src/data/vehicles/types";
import { DrivelineCommands } from "../../src/vehicle/Driveline";
import Engine, { IDLE_GOVERNOR_BAND_RPM } from "../../src/vehicle/Engine";
import Powertrain, { PowertrainRequest } from "../../src/vehicle/Powertrain";
import TorqueConverter from "../../src/vehicle/TorqueConverter";
import { createVehicleState, NEUTRAL_GEAR, REVERSE_GEAR } from "../../src/vehicle/VehicleState";

const DT = 1 / 60; // s
const WHEEL_RADIUS = 0.3; // m
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
	engineInertia: 0.2, // kg·m²
	shiftTime: 0.2, // s
	topSpeed: 50, // m/s
	boostTorqueMultiplier: 1.5,
	friction: { idleTorque: 20, revLimitTorque: 80 }, // N·m
	clutch: { maxTorque: 600, engagementStartRpm: 800, engagementRpm: 2800 }, // N·m, rpm
	differentials: {},
});

const FULL: PowertrainRequest = { throttle: 1, reverse: false, boost: false };

function createCommands(): DrivelineCommands {
	return { throttle: 0, torqueMultiplier: 1, gearRatio: 0, clutchTorque: 0, converterCoupling: 0 };
}

function setup(config: VehiclePowertrainConfig = CONFIG) {
	const state = createVehicleState(config.idleRpm);
	const out = createCommands();
	const powertrain = new Powertrain(config, WHEEL_RADIUS, state);
	/** Passo com o motor na rotação da entrada do câmbio (embreagem travada) */
	const step = (request: PowertrainRequest, speed: number, engineRpm?: number) => {
		state.engineRpm = engineRpm ?? Math.max(config.idleRpm, rpmAt(speed, state.gear));
		powertrain.step(request, speed, DT, speed, out);
		return out;
	};
	return { state, out, powertrain, step };
}

/** Rotação da entrada do câmbio (rpm) na marcha dada e velocidade (m/s) */
function rpmAt(speed: number, gear: number): number {
	const ratio = gear === REVERSE_GEAR ? CONFIG.reverseRatio : gear === NEUTRAL_GEAR ? 0 : CONFIG.gearRatios[gear - 1];
	return (Math.abs(speed) / WHEEL_RADIUS) * ratio * CONFIG.finalDriveRatio * RPM_PER_RAD_S;
}

/** Velocidade (m/s) em que o motor gira a `rpm` na marcha dada */
function speedAt(rpm: number, gear: number): number {
	return ((rpm / RPM_PER_RAD_S) * WHEEL_RADIUS) / (CONFIG.gearRatios[gear - 1] * CONFIG.finalDriveRatio);
}

describe("Engine", () => {
	const engine = new Engine(CONFIG);
	const at = (rpm: number) => rpm / RPM_PER_RAD_S;

	it("curva de torque interpolada e limitada às pontas", () => {
		expect(engine.fullLoadTorque(500)).toBe(200);
		expect(engine.fullLoadTorque(2000)).toBe(300);
		expect(engine.fullLoadTorque(4500)).toBe(350);
		expect(engine.fullLoadTorque(9000)).toBe(300);
		expect(engine.peakTorque).toBe(400);
	});

	it("acelerador pleno dá a curva; sem acelerador, o arrasto (freio-motor) interpolado na rotação", () => {
		expect(engine.torque(at(3000), 1, 1)).toBeCloseTo(400, 9);
		expect(engine.torque(at(3000), 1, 1.5)).toBeCloseTo(600, 9);
		expect(engine.torque(at(3000), 0.5, 1)).toBeCloseTo(0.5 * 400 - 0.5 * engine.frictionTorque(3000), 9);
		const middle = (CONFIG.idleRpm + CONFIG.revLimitRpm) / 2;
		expect(engine.frictionTorque(middle)).toBeCloseTo(50, 9);
		expect(engine.torque(at(middle), 0, 1)).toBeCloseTo(-50, 9);
	});

	it("controle de lenta: acelerador todo na lenta, nenhum a partir da lenta + faixa", () => {
		expect(engine.effectiveThrottle(CONFIG.idleRpm, 0)).toBe(1);
		expect(engine.effectiveThrottle(CONFIG.idleRpm + IDLE_GOVERNOR_BAND_RPM / 2, 0)).toBeCloseTo(0.5, 9);
		expect(engine.effectiveThrottle(CONFIG.idleRpm + IDLE_GOVERNOR_BAND_RPM, 0)).toBe(0);
	});

	it("corte de giro: acelerador efetivo cai a zero no limite e o motor só arrasta", () => {
		expect(engine.effectiveThrottle(CONFIG.revLimitRpm - 100, 1)).toBeCloseTo(0.5, 9);
		expect(engine.effectiveThrottle(CONFIG.revLimitRpm, 1)).toBe(0);
		expect(engine.torque(at(CONFIG.revLimitRpm + 50), 1, 1)).toBeCloseTo(-CONFIG.friction.revLimitTorque, 9);
	});
});

describe("TorqueConverter", () => {
	const config = { stallRpm: 2500, stallTorqueRatio: 2, couplingSpeedRatio: 0.85 };
	const stallTorque = 450; // N·m
	const converter = new TorqueConverter(config, stallTorque);
	const stall = 2500 / RPM_PER_RAD_S;

	it("no estol absorve o torque do motor e o multiplica na turbina", () => {
		expect(converter.pumpTorque(stall, 0)).toBeCloseTo(stallTorque, 9);
		expect(converter.turbineTorque(stall, 0)).toBeCloseTo(2 * stallTorque, 9);
		expect(converter.pumpTorque(stall / 2, 0)).toBeCloseTo(stallTorque / 4, 9);
	});

	it("multiplicação cai até 1 no ponto de acoplamento e o torque a zero com as rotações iguais", () => {
		expect(converter.turbineTorque(stall, 0.85 * stall)).toBeCloseTo(converter.pumpTorque(stall, 0.85 * stall), 9);
		expect(converter.turbineTorque(stall, 0.425 * stall) / converter.pumpTorque(stall, 0.425 * stall)).toBeCloseTo(
			1.5,
			9,
		);
		expect(converter.pumpTorque(stall, stall)).toBe(0);
	});

	it("turbina mais rápida arrasta o motor (freio-motor), sem multiplicação; torque cresce com a rotação do motor", () => {
		expect(converter.pumpTorque(0.9 * stall, stall)).toBeLessThan(0);
		expect(converter.turbineTorque(0.9 * stall, stall)).toBe(converter.pumpTorque(0.9 * stall, stall));
		let previous = -Infinity;
		for (let rpm = 0; rpm <= 4000; rpm += 50) {
			const torque = converter.pumpTorque(rpm / RPM_PER_RAD_S, 0.6 * stall);
			expect(torque).toBeGreaterThanOrEqual(previous);
			previous = torque;
		}
	});
});

describe("Powertrain", () => {
	it("relação total: caixa × diferencial; negativa em ré, 0 em ponto morto", () => {
		const { powertrain } = setup();
		expect(powertrain.overallRatio(1)).toBe(12);
		expect(powertrain.overallRatio(4)).toBe(4);
		expect(powertrain.overallRatio(REVERSE_GEAR)).toBeCloseTo(-12.8, 12);
		expect(powertrain.overallRatio(NEUTRAL_GEAR)).toBe(0);
	});

	it("comandos: acelerador, marcha e embreagem fechada rodando acima da rotação de engate", () => {
		const { step } = setup();
		const out = step(FULL, speedAt(3000, 1));

		expect(out.throttle).toBe(1);
		expect(out.gearRatio).toBe(12);
		expect(out.torqueMultiplier).toBe(1);
		expect(out.clutchTorque).toBe(CONFIG.clutch.maxTorque);
		expect(out.converterCoupling).toBe(0);
	});

	it("arrancada: embreagem fecha com a rotação do motor; parado sem acelerador fica aberta", () => {
		const { step } = setup();
		expect(step({ ...FULL, throttle: 0 }, 0, CONFIG.idleRpm).clutchTorque).toBe(0);
		expect(step(FULL, 0, 1800).clutchTorque).toBeCloseTo(CONFIG.clutch.maxTorque / 2, 9);
		expect(step(FULL, 0, 3000).clutchTorque).toBe(CONFIG.clutch.maxTorque);
	});

	it("rodando sem acelerador, a embreagem abre quando a entrada do câmbio cai para a lenta", () => {
		const { step } = setup();
		expect(step({ ...FULL, throttle: 0 }, speedAt(1800, 1)).clutchTorque).toBeCloseTo(
			CONFIG.clutch.maxTorque / 2,
			9,
		);
		expect(step({ ...FULL, throttle: 0 }, speedAt(CONFIG.idleRpm, 1)).clutchTorque).toBeCloseTo(0, 9);
	});

	it("sobe de marcha no giro de troca: embreagem reabre ao longo da troca e o acelerador corta até sincronizar", () => {
		const { state, step } = setup();
		const speed = speedAt(6010, 1);

		const start = step(FULL, speed, 6010);
		expect(state.gear).toBe(2);
		expect(start.throttle).toBe(0);
		expect(start.clutchTorque).toBe(0);

		const synchronized = step(FULL, speed, rpmAt(speed, 2));
		expect(synchronized.throttle).toBe(1);
		expect(synchronized.clutchTorque).toBeCloseTo((DT / CONFIG.shiftTime) * CONFIG.clutch.maxTorque, 9);

		let steps = 2;
		while (state.shiftTimeRemaining > 0) {
			step(FULL, speed);
			steps++;
		}
		expect((steps - 1) * DT).toBeCloseTo(CONFIG.shiftTime, 6);
		for (let i = 0; i < 120; i++) step(FULL, speed);
		expect(state.gear).toBe(2);
	});

	it("desce de marcha abaixo do giro de redução e acelera o motor até a rotação nova", () => {
		const { state, step } = setup();
		state.gear = 3;
		const speed = speedAt(2400, 3);
		const out = step({ ...FULL, throttle: 0 }, speed, 2400);
		expect(state.gear).toBe(2);
		expect(out.throttle).toBeCloseTo(Math.min(1, (rpmAt(speed, 2) - 2400) / 500), 9);

		// 2ª → 1ª levaria a 7.200 rpm: fica na 2ª
		const wide = setup({ ...CONFIG, gearRatios: [6, 2, 1.4, 1] });
		wide.state.gear = 2;
		wide.step(FULL, speedAt(2400, 2), 2400);
		expect(wide.state.gear).toBe(2);
	});

	it("limitador de velocidade corta o acelerador na velocidade máxima", () => {
		const { state, step } = setup();
		state.gear = 4;
		expect(step(FULL, CONFIG.topSpeed).throttle).toBe(0);
		expect(step(FULL, CONFIG.topSpeed - 0.5).throttle).toBeCloseTo(0.5, 9);
	});

	it("ré com relação própria; boost no multiplicador; acelerador volta à 1ª", () => {
		const { state, step } = setup();
		const reverse = step({ throttle: 1, reverse: true, boost: true }, -1, 2000);

		expect(state.gear).toBe(REVERSE_GEAR);
		expect(reverse.gearRatio).toBeCloseTo(-12.8, 12);
		expect(reverse.throttle).toBe(1);
		expect(reverse.torqueMultiplier).toBe(CONFIG.boostTorqueMultiplier);
		expect(state.boostMultiplier).toBe(CONFIG.boostTorqueMultiplier);

		step(FULL, 0);
		expect(state.gear).toBe(1);
	});

	it("ponto morto fica sem acelerador e sai com acelerador na marcha da velocidade", () => {
		const { state, step } = setup();
		state.gear = NEUTRAL_GEAR;
		const neutral = step({ ...FULL, throttle: 0 }, speedAt(4500, 2), 3000);
		expect(state.gear).toBe(NEUTRAL_GEAR);
		expect(neutral.gearRatio).toBe(0);
		expect(neutral.clutchTorque).toBe(0);

		step(FULL, speedAt(4500, 2), 3000);
		expect(state.gear).toBe(2);
	});

	it("com conversor: desacopla parado sem acelerador; travamento pela rotação da entrada do câmbio", () => {
		const withConverter: VehiclePowertrainConfig = {
			...CONFIG,
			torqueConverter: { stallRpm: 2500, stallTorqueRatio: 2, couplingSpeedRatio: 0.85 },
			clutch: { maxTorque: 600, engagementStartRpm: 1500, engagementRpm: 2000 },
		};
		const { step } = setup(withConverter);
		const idle = step({ ...FULL, throttle: 0 }, 0, CONFIG.idleRpm);
		expect(idle.converterCoupling).toBe(0);
		expect(idle.clutchTorque).toBe(0);

		const launch = step(FULL, 0, 2500);
		expect(launch.converterCoupling).toBe(1);
		expect(launch.clutchTorque).toBe(0);

		expect(step(FULL, speedAt(1750, 1), 2500).clutchTorque).toBeCloseTo(300, 9);
		expect(step(FULL, speedAt(2500, 1)).clutchTorque).toBe(600);
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

		expect(p.friction.idleTorque).toBeGreaterThan(0);
		expect(p.friction.revLimitTorque).toBeGreaterThanOrEqual(p.friction.idleTorque);
		const peak = Math.max(...p.torqueCurve.map((point) => point.torque));
		expect(p.clutch.maxTorque).toBeGreaterThan(peak * p.boostTorqueMultiplier);
		expect(p.clutch.engagementStartRpm).toBeGreaterThanOrEqual(p.idleRpm);
		expect(p.clutch.engagementRpm).toBeGreaterThan(p.clutch.engagementStartRpm);
		if (p.torqueConverter) {
			expect(p.torqueConverter.stallTorqueRatio).toBeGreaterThanOrEqual(1);
			expect(p.torqueConverter.couplingSpeedRatio).toBeGreaterThan(0);
			expect(p.torqueConverter.couplingSpeedRatio).toBeLessThan(1);
		}

		const traction = definition.configs.tractionDisplacement;
		const used = traction === "all" ? ["front", "rear", "center"] : [traction];
		for (const name of used) {
			const differential = p.differentials[name as "front" | "rear" | "center"]!;
			expect(differential).toBeDefined();
			expect(differential.torqueSplit).toBeGreaterThan(0);
			expect(differential.torqueSplit).toBeLessThan(1);
			expect(differential.preloadTorque).toBeGreaterThanOrEqual(0);
			expect(differential.powerLocking).toBeGreaterThanOrEqual(0);
			expect(differential.coastLocking).toBeGreaterThanOrEqual(0);
			expect(differential.viscousCoupling).toBeGreaterThanOrEqual(0);
		}
	});
});
