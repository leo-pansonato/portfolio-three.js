import { describe, expect, it } from "vitest";
import { VehicleSuspensionConfig } from "../../src/data/vehicles/types";
import Suspension, { bumpStopForce, damperForce } from "../../src/vehicle/Suspension";

const CONFIG: VehicleSuspensionConfig = {
	springRate: 40000,
	compressionDamping: 4000,
	reboundDamping: 2000,
	maxCompression: 0.2,
	bumpStopLength: 0.05,
	bumpStopStiffness: 1e7,
	antiRollStiffness: { front: 10000, rear: 5000 },
};
const REST = 0.5;

describe("Suspension — forças por roda", () => {
	it("mola linear: F = k·x a partir do comprimento livre", () => {
		const suspension = new Suspension(CONFIG, REST, 1);
		suspension.setContact(0, true, 0.4, 0);
		suspension.computeForces();

		expect(suspension.wheels[0].compression).toBeCloseTo(0.1, 12);
		expect(suspension.wheels[0].springForce).toBeCloseTo(4000, 9);
		expect(suspension.wheels[0].force).toBeCloseTo(4000, 9);
	});

	it("amortecedor assimétrico: compressão e extensão com coeficientes próprios", () => {
		expect(damperForce(CONFIG, 0.5)).toBeCloseTo(2000, 9);
		expect(damperForce(CONFIG, -0.5)).toBeCloseTo(-1000, 9);
		expect(damperForce(CONFIG, 0)).toBe(0);
	});

	it("força total nunca puxa o chassi para o chão", () => {
		const suspension = new Suspension(CONFIG, REST, 1);
		suspension.setContact(0, true, 0.49, -2);
		suspension.computeForces();

		expect(suspension.wheels[0].springForce + suspension.wheels[0].damperForce).toBeLessThan(0);
		expect(suspension.wheels[0].force).toBe(0);
	});

	it("sem contato: roda estendida e sem força", () => {
		const suspension = new Suspension(CONFIG, REST, 1);
		suspension.setContact(0, false, 0.1, 3);
		suspension.computeForces();

		expect(suspension.wheels[0].length).toBe(REST);
		expect(suspension.wheels[0].compression).toBe(0);
		expect(suspension.wheels[0].force).toBe(0);
	});

	it("comprimento limitado a [0, comprimento livre]", () => {
		const suspension = new Suspension(CONFIG, REST, 1);
		suspension.setContact(0, true, 0.8, 0);
		expect(suspension.wheels[0].compression).toBe(0);
		suspension.setContact(0, true, -0.1, 0);
		expect(suspension.wheels[0].compression).toBe(REST);
	});
});

describe("Suspension — batente progressivo", () => {
	it("zero antes da zona, quadrático na penetração", () => {
		const start = CONFIG.maxCompression - CONFIG.bumpStopLength;
		expect(bumpStopForce(CONFIG, start - 0.01)).toBe(0);
		expect(bumpStopForce(CONFIG, start)).toBe(0);
		expect(bumpStopForce(CONFIG, start + 0.01)).toBeCloseTo(1e7 * 1e-4, 6);
		expect(bumpStopForce(CONFIG, CONFIG.maxCompression)).toBeCloseTo(1e7 * 0.05 ** 2, 6);
	});

	it("rigidez cresce com a penetração (progressivo)", () => {
		const start = CONFIG.maxCompression - CONFIG.bumpStopLength;
		const h = 1e-4;
		const stiffnessAt = (x: number) => (bumpStopForce(CONFIG, x + h) - bumpStopForce(CONFIG, x - h)) / (2 * h);
		expect(stiffnessAt(start + 0.04)).toBeGreaterThan(stiffnessAt(start + 0.01) * 3);
	});

	it("entra na força total da roda", () => {
		const suspension = new Suspension(CONFIG, REST, 1);
		suspension.setContact(0, true, REST - CONFIG.maxCompression, 0);
		suspension.computeForces();
		const wheel = suspension.wheels[0];

		expect(wheel.bumpStopForce).toBeCloseTo(25000, 6);
		expect(wheel.force).toBeCloseTo(CONFIG.springRate * CONFIG.maxCompression + 25000, 6);
	});
});

describe("Suspension — barra estabilizadora por eixo", () => {
	it("F = k_barra·(x_esq − x_dir), oposta nas duas rodas do eixo", () => {
		const suspension = new Suspension(CONFIG, REST);
		suspension.setContact(0, true, 0.4, 0);
		suspension.setContact(1, true, 0.44, 0);
		suspension.setContact(2, true, 0.45, 0);
		suspension.setContact(3, true, 0.43, 0);
		suspension.computeForces();
		const [fl, fr, rl, rr] = suspension.wheels;

		expect(fl.antiRollForce).toBeCloseTo(10000 * 0.04, 9);
		expect(fr.antiRollForce).toBeCloseTo(-10000 * 0.04, 9);
		expect(rl.antiRollForce).toBeCloseTo(5000 * -0.02, 9);
		expect(rr.antiRollForce).toBeCloseTo(5000 * 0.02, 9);
		expect(fl.force).toBeCloseTo(40000 * 0.1 + 400, 9);
	});

	it("eixo com compressões iguais: barra sem força; soma do eixo não muda com a barra", () => {
		const suspension = new Suspension(CONFIG, REST);
		for (let i = 0; i < 4; i++) suspension.setContact(i, true, 0.42, 0);
		suspension.computeForces();
		expect(suspension.wheels.every((w) => w.antiRollForce === 0)).toBe(true);

		suspension.setContact(0, true, 0.4, 0);
		suspension.setContact(1, true, 0.44, 0);
		suspension.computeForces();
		const front = suspension.wheels[0].force + suspension.wheels[1].force;
		expect(front).toBeCloseTo(40000 * (0.1 + 0.06), 9);
	});

	it("roda no ar: a barra ainda empurra a roda apoiada", () => {
		const suspension = new Suspension(CONFIG, REST);
		suspension.setContact(0, true, 0.4, 0);
		suspension.setContact(1, false, 0, 0);
		suspension.computeForces();

		expect(suspension.wheels[0].antiRollForce).toBeCloseTo(1000, 9);
		expect(suspension.wheels[1].force).toBe(0);
	});
});
