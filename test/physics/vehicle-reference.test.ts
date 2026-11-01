import { afterAll, describe, expect, it, vi } from "vitest";
import { BaselineFile } from "../support/baseline";
import { createRapierSim } from "../support/rapierSim";
import { accelerationScenario, brakingScenario, restScenario, turnScenario } from "../support/scenarios";

// Sem rede/arquivos em Node: o Player usa o fallback de primitivas (física idêntica)
vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		clearCache(): void {}
	},
}));

/**
 * Cenários de referência do veículo (ROADMAP P0-4) (Rapier).
 * Linha de base: test/baselines/rapier.json.
 */

const baseline = new BaselineFile(new URL("../baselines/rapier.json", import.meta.url));
afterAll(() => baseline.save());

const VEHICLES = ["bmw_f82", "mercedes_g63"];
const FRAME_DT = 1 / 60;

describe.each(VEHICLES)("veículo %s — cenários de referência", (vehicleId) => {
	it("repouso: assenta sem derivar", async () => {
		const result = restScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		expect(result.residualSpeed).toBeLessThan(0.05);
		expect(result.drift).toBeLessThan(0.05);
		expect(result.finalTilt).toBeLessThan(0.05);
		expect(baseline.check(`${vehicleId}.rest`, result)).toEqual([]);
	});

	it("aceleração em reta por 5 s", async () => {
		const result = accelerationScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		// velocidade cresce a cada segundo
		for (let i = 1; i < result.hudSpeedAt.length; i++) {
			expect(result.hudSpeedAt[i]).toBeGreaterThan(result.hudSpeedAt[i - 1]);
		}
		expect(baseline.check(`${vehicleId}.acceleration`, result)).toEqual([]);
	});

	it("frenagem até parar", async () => {
		const result = brakingScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		expect(result.timeToStop).toBeLessThan(10);
		expect(baseline.check(`${vehicleId}.braking`, result)).toEqual([]);
	});

	it("curva com acelerador e volante à esquerda", async () => {
		const result = turnScenario(await createRapierSim(vehicleId), FRAME_DT);

		expect(result.nonFinite).toBe(false);
		expect(result.yawRate).toBeGreaterThan(0);
		expect(result.maxTilt).toBeLessThan(Math.PI / 4);
		expect(baseline.check(`${vehicleId}.turn`, result)).toEqual([]);
	});
});

/**
 * Documenta a dependência de taxa de quadros (ARCHITECTURE.md R4):
 * o volante e as forças são aplicados por quadro, não por passo de física.
 * Este teste registra o comportamento atual; o P1-1 deve torná-lo independente de FPS.
 */
describe("dependência de taxa de quadros (bmw_f82)", () => {
	it.each([30, 60, 144])("aceleração a %i FPS", async (fps) => {
		const result = accelerationScenario(await createRapierSim("bmw_f82"), 1 / fps);

		expect(result.nonFinite).toBe(false);
		expect(baseline.check(`bmw_f82.acceleration@${fps}fps`, result)).toEqual([]);
	});
});
