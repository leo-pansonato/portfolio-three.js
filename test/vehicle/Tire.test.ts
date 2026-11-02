import { describe, expect, it } from "vitest";
import { VEHICLE_DEFINITIONS } from "../../src/data/vehicles";
import { PacejkaCurve, VehicleTireConfig } from "../../src/data/vehicles/types";
import Tire, { magicFormula, peakSlip, slipAngle, slipRatio, TireForces } from "../../src/vehicle/Tire";

const CONFIG: VehicleTireConfig = {
	longitudinal: { stiffness: 20, shape: 1.4, peakFriction: 1.1, curvature: 0 },
	lateral: { stiffness: 15, shape: 1.3, peakFriction: 1.0, curvature: 0 },
	lowSpeedThreshold: 1,
};
const LOAD = 4000; // N

function forces(tire: Tire, ratio: number, angle: number, load = LOAD): TireForces {
	return tire.computeForces(ratio, angle, load, { longitudinal: 0, lateral: 0 });
}

/** Maior valor de f em [0, max] por amostragem fina */
function sampledPeak(f: (x: number) => number, max: number): { x: number; value: number } {
	let best = { x: 0, value: -Infinity };
	for (let i = 0; i <= 200000; i++) {
		const x = (max * i) / 200000;
		const value = f(x);
		if (value > best.value) best = { x, value };
	}
	return best;
}

describe("Tire — curva de Pacejka", () => {
	it("pico com E = 0 em tan(π/2C)/B, de valor 1 (normalizado)", () => {
		const curve = CONFIG.longitudinal;
		const expected = Math.tan(Math.PI / (2 * curve.shape)) / curve.stiffness;
		expect(peakSlip(curve)).toBeCloseTo(expected, 10);
		expect(magicFormula(curve, expected)).toBeCloseTo(1, 12);
	});

	it.each([-1, -0.5, 0.5, 0.9])("pico calculado coincide com o máximo amostrado (E = %f)", (curvature) => {
		const curve: PacejkaCurve = { ...CONFIG.lateral, curvature };
		const sampled = sampledPeak((x) => magicFormula(curve, x), 1);
		expect(peakSlip(curve)).toBeCloseTo(sampled.x, 4);
		expect(sampled.value).toBeCloseTo(1, 8);
	});

	it("rejeita curva sem pico (C ≤ 1) ou com E > 1", () => {
		expect(() => peakSlip({ ...CONFIG.lateral, shape: 1 })).toThrow();
		expect(() => peakSlip({ ...CONFIG.lateral, curvature: 1.1 })).toThrow();
	});
});

describe("Tire — forças puras", () => {
	const tire = new Tire(CONFIG);

	it("longitudinal: pico μ·Fz no escorregamento de pico, menor antes e depois", () => {
		const peak = tire.peakSlipRatio;
		expect(forces(tire, peak, 0).longitudinal).toBeCloseTo(CONFIG.longitudinal.peakFriction * LOAD, 6);
		expect(forces(tire, peak * 0.8, 0).longitudinal).toBeLessThan(forces(tire, peak, 0).longitudinal);
		expect(forces(tire, peak * 1.2, 0).longitudinal).toBeLessThan(forces(tire, peak, 0).longitudinal);
		expect(Math.abs(forces(tire, peak, 0).lateral)).toBe(0);
	});

	it("lateral: pico μ·Fz no ângulo de pico, oposta ao ângulo", () => {
		const peak = tire.peakSlipAngle;
		expect(forces(tire, 0, peak).lateral).toBeCloseTo(-CONFIG.lateral.peakFriction * LOAD, 6);
		expect(Math.abs(forces(tire, 0, peak * 0.7).lateral)).toBeLessThan(CONFIG.lateral.peakFriction * LOAD);
		expect(Math.abs(forces(tire, 0, peak).longitudinal)).toBe(0);
	});

	it("força lateral zero com ângulo zero, com ou sem escorregamento longitudinal", () => {
		for (const ratio of [0, 0.05, -0.3, 2]) expect(Math.abs(forces(tire, ratio, 0).lateral)).toBe(0);
		expect(forces(tire, 0, 0)).toEqual({ longitudinal: 0, lateral: 0 });
	});

	it("simetria: inverter o escorregamento inverte a força", () => {
		for (const ratio of [0.01, 0.1, 0.5, 3]) {
			for (const angle of [0, 0.02, 0.2]) {
				const a = forces(tire, ratio, angle);
				const b = forces(tire, -ratio, -angle);
				expect(b.longitudinal).toBeCloseTo(-a.longitudinal, 9);
				expect(b.lateral).toBeCloseTo(-a.lateral, 9);
				expect(forces(tire, ratio, -angle).longitudinal).toBeCloseTo(a.longitudinal, 9);
			}
		}
	});

	it("rigidez inicial = B·C·μ·Fz e saturação em μ·Fz·sin(C·π/2) com escorregamento grande", () => {
		const { longitudinal, lateral } = CONFIG;
		const small = 1e-5;
		expect(forces(tire, small, 0).longitudinal / small).toBeCloseTo(
			longitudinal.stiffness * longitudinal.shape * longitudinal.peakFriction * LOAD,
			-1,
		);
		expect(-forces(tire, 0, small).lateral / small).toBeCloseTo(
			lateral.stiffness * lateral.shape * lateral.peakFriction * LOAD,
			-1,
		);
		const sliding = forces(tire, 1e4, 0).longitudinal;
		expect(sliding).toBeCloseTo(longitudinal.peakFriction * LOAD * Math.sin((longitudinal.shape * Math.PI) / 2), 0);
		expect(sliding).toBeLessThan(longitudinal.peakFriction * LOAD);
	});

	it("proporcional à carga normal; sem carga, sem força", () => {
		const one = forces(tire, 0.07, 0.05, LOAD);
		const two = forces(tire, 0.07, 0.05, 2 * LOAD);
		expect(two.longitudinal).toBeCloseTo(2 * one.longitudinal, 9);
		expect(two.lateral).toBeCloseTo(2 * one.lateral, 9);
		expect(forces(tire, 0.07, 0.05, 0)).toEqual({ longitudinal: 0, lateral: 0 });
		expect(forces(tire, 0.07, 0.05, -10)).toEqual({ longitudinal: 0, lateral: 0 });
	});
});

describe("Tire — atrito combinado", () => {
	const configs: [string, VehicleTireConfig][] = [
		["teste", CONFIG],
		...Object.entries(VEHICLE_DEFINITIONS).map(([id, d]): [string, VehicleTireConfig] => [id, d.tire]),
	];
	it.each(configs)("%s: nunca sai da elipse (μx·Fz, μy·Fz) nem passa de max(μ)·Fz", (_id, config) => {
		const tire = new Tire(config);
		const muX = config.longitudinal.peakFriction * LOAD;
		const muY = config.lateral.peakFriction * LOAD;
		let worst = 0;
		for (let i = -60; i <= 60; i++) {
			for (let j = -60; j <= 60; j++) {
				const ratio = Math.sign(i) * (Math.abs(i) / 20) ** 2;
				const angle = Math.sign(j) * (Math.abs(j) / 60) ** 2 * (Math.PI / 2);
				const f = forces(tire, ratio, angle);
				worst = Math.max(worst, (f.longitudinal / muX) ** 2 + (f.lateral / muY) ** 2);
				expect(Math.hypot(f.longitudinal, f.lateral)).toBeLessThanOrEqual(Math.max(muX, muY) * (1 + 1e-12));
			}
		}
		expect(worst).toBeLessThanOrEqual(1 + 1e-12);
		expect(worst).toBeGreaterThan(0.999);
	});

	it("escorregamento longitudinal reduz a força lateral; roda travada quase não segura de lado", () => {
		const tire = new Tire(CONFIG);
		const angle = tire.peakSlipAngle / 2;
		const free = Math.abs(forces(tire, 0, angle).lateral);
		const braking = Math.abs(forces(tire, -tire.peakSlipRatio / 2, angle).lateral);
		const locked = Math.abs(forces(tire, -1, angle).lateral);
		expect(braking).toBeLessThan(free);
		expect(locked).toBeLessThan(0.15 * free);
	});
});

describe("Tire — escorregamento com regularização em baixa velocidade", () => {
	it("em velocidade: (ω·r − vx)/|vx| e atan(vy/|vx|)", () => {
		expect(slipRatio(22, 20, 1)).toBeCloseTo(0.1, 12);
		expect(slipRatio(0, 20, 1)).toBe(-1);
		expect(slipRatio(-22, -20, 1)).toBeCloseTo(-0.1, 12);
		expect(slipAngle(20, 2, 1)).toBeCloseTo(Math.atan(0.1), 12);
		expect(slipAngle(-20, 2, 1)).toBeCloseTo(Math.atan(0.1), 12);
	});

	it("parado: zero, finito e limitado pelo denominador mínimo", () => {
		expect(slipRatio(0, 0, 1)).toBe(0);
		expect(slipAngle(0, 0, 1)).toBe(0);
		expect(slipRatio(0.01, 0, 1)).toBeCloseTo(0.01, 12);
		expect(slipAngle(0, 0.01, 1)).toBeCloseTo(Math.atan(0.01), 12);
		expect(Number.isFinite(slipRatio(3, 1e-9, 1))).toBe(true);
	});
});
