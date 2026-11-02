import { afterAll, describe, expect, it, vi } from "vitest";
import { BaselineFile } from "../support/baseline";
import { createRapierSim } from "../support/rapierSim";
import {
	accelerationScenario,
	brakingFromHundredScenario,
	brakingScenario,
	restScenario,
	turnScenario,
} from "../support/scenarios";

// Sem rede/arquivos em Node: o Player usa o fallback de primitivas (física idêntica)
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
 * Independência de taxa de quadros (ROADMAP P1-1): volante e forças rodam no
 * pré-passo da física com o input mais recente, então o mesmo roteiro produz a
 * mesma sequência de passos a 30, 60 e 144 FPS. Os trechos dos cenários são
 * múltiplos de 1/60 s; só a detecção de parada é amostrada por quadro.
 */
describe.each(VEHICLES)("independência de FPS (%s)", (vehicleId) => {
	// mesma sequência de passos; resta a amostragem por quadro das métricas
	// (trajetória da curva somada em cordas). Antes do P1-1 a diferença a 30 FPS era 0,3–1%.
	const REL_TOL = 1e-4;
	const close = (actual: number, expected: number, absTol = 1e-9) =>
		expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * REL_TOL + absTol);

	it.each([30, 144])("aceleração, frenagem e curva a %i FPS iguais às de 60 FPS", async (fps) => {
		const sim = () => createRapierSim(vehicleId);
		const ref = {
			acceleration: accelerationScenario(await sim(), 1 / 60),
			braking: brakingScenario(await sim(), 1 / 60),
			turn: turnScenario(await sim(), 1 / 60),
		};
		const acceleration = accelerationScenario(await sim(), 1 / fps);
		const braking = brakingScenario(await sim(), 1 / fps);
		const turn = turnScenario(await sim(), 1 / fps);

		acceleration.hudSpeedAt.forEach((v, i) => close(v, ref.acceleration.hudSpeedAt[i]));
		close(acceleration.distance, ref.acceleration.distance);
		close(braking.initialHudSpeed, ref.braking.initialHudSpeed);
		// a parada só é vista no fim do quadro: até 1 quadro de 30 FPS de diferença, quase parado (1 cm)
		close(braking.stoppingDistance, ref.braking.stoppingDistance, 0.01);
		expect(Math.abs(braking.timeToStop - ref.braking.timeToStop)).toBeLessThanOrEqual(1 / 30 + 1e-9);
		close(turn.speed, ref.turn.speed);
		close(turn.yawRate, ref.turn.yawRate);
	});
});

/**
 * Freio em força (N), convertido em impulso pelo passo ao aplicar: a frenagem
 * não depende do passo da física. Antes, a 1/120 s a desaceleração subia ~55%.
 */
describe.each(VEHICLES)("frenagem independente do passo (%s)", (vehicleId) => {
	it("frenagem de 100 km/h igual com passo de 1/60 e 1/120 s", async () => {
		const at60 = brakingFromHundredScenario(await createRapierSim(vehicleId, 1 / 60), 1 / 60);
		const at120 = brakingFromHundredScenario(await createRapierSim(vehicleId, 1 / 120), 1 / 120);

		// 2%: o resto do controlador (suspensão, atrito lateral) também é discretizado pelo passo
		expect(Math.abs(at120.meanDeceleration / at60.meanDeceleration - 1)).toBeLessThan(0.02);
		expect(Math.abs(at120.stoppingDistance / at60.stoppingDistance - 1)).toBeLessThan(0.02);
	});
});
