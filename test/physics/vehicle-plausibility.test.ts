import { describe, expect, it, vi } from "vitest";
import { createRapierSim } from "../support/rapierSim";
import { brakingFromHundredScenario, restScenario, turnScenario, zeroToHundredScenario } from "../support/scenarios";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		releaseModel(): void {}
		isCached(): boolean {
			return false;
		}
		clearCache(): void {}
	},
}));

/**
 * Limites de plausibilidade física em SI (ADR-0002), além da linha de base.
 * Faixas largas de propósito: o controlador raycast não tem câmbio, arrasto
 * nem modelo de pneu (ARCHITECTURE §3.2); o teste pega erro de escala/unidade,
 * não ajuste fino.
 */

const FRAME_DT = 1 / 60;
const G = 9.82; // m/s², igual ao mundo (RapierPhysicsWorld)

/** 0–100 km/h (s): referências de fábrica M4 F82 ~4,1 s, G63 W463A ~4,5 s, com folga para o modelo sem câmbio */
const ZERO_TO_HUNDRED: Record<string, [number, number]> = {
	bmw_f82: [3.5, 6],
	mercedes_g63: [4, 7],
};

describe.each(Object.keys(ZERO_TO_HUNDRED))("veículo %s — plausibilidade física", (vehicleId) => {
	it("repouso estável: sem deriva, sem oscilação, nivelado", async () => {
		const result = restScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		// 1 cm em 8 s e 1 cm/s: abaixo do perceptível na câmera interna
		expect(result.drift).toBeLessThan(0.01);
		expect(result.residualSpeed).toBeLessThan(0.01);
		// ~0,6° (assimetria das rodas dianteiras/traseiras inclina pouco o chassi)
		expect(result.finalTilt).toBeLessThan(0.01);
	});

	it("0–100 km/h dentro da faixa do carro real", async () => {
		const result = zeroToHundredScenario(await createRapierSim(vehicleId), FRAME_DT);
		const [min, max] = ZERO_TO_HUNDRED[vehicleId];

		expect(result.nonFinite).toBe(false);
		expect(result.time).toBeGreaterThan(min);
		expect(result.time).toBeLessThan(max);
	});

	it("frenagem de 100 km/h: desaceleração média de pneu de rua em asfalto seco", async () => {
		const result = brakingFromHundredScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		// ~0,7–1,2 g: carro de rua com ABS em piso seco
		expect(result.meanDeceleration).toBeGreaterThan(7);
		expect(result.meanDeceleration).toBeLessThan(12);
	});

	it("curva em regime: aceleração lateral abaixo do limite de pneu de rua", async () => {
		const result = turnScenario(await createRapierSim(vehicleId), FRAME_DT);
		const lateralAccel = result.speed * Math.abs(result.yawRate);

		expect(result.nonFinite).toBe(false);
		// > 0,5 g: o carro de fato faz a curva; < 1,3 g: acima disso só pneu slick/aerodinâmica
		expect(lateralAccel).toBeGreaterThan(0.5 * G);
		expect(lateralAccel).toBeLessThan(1.3 * G);
	});
});
