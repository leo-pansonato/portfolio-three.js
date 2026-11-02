import { describe, expect, it, vi } from "vitest";
import { createRapierSim } from "../support/rapierSim";
import { getVehicleDefinition } from "../../src/data/vehicles";
import Tire from "../../src/vehicle/Tire";
import { brakingFromHundredScenario, restScenario, skidpadScenario, zeroToHundredScenario } from "../support/scenarios";

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
 * Faixas de carro de rua real com folga para o modelo (pneu próprio, ADR-0003 etapa 3).
 */

const FRAME_DT = 1 / 60;
const G = 9.82; // m/s², igual ao mundo (RapierPhysicsWorld)

/** 0–100 km/h (s): referências de fábrica M4 F82 ~4,1 s, G63 W463A ~4,5 s */
const ZERO_TO_HUNDRED: Record<string, [number, number]> = {
	bmw_f82: [3.8, 5],
	mercedes_g63: [4.0, 6],
};

/** Aceleração lateral máxima em regime (g): pneu esportivo de rua e SUV pesado */
const LATERAL_GRIP: Record<string, [number, number]> = {
	bmw_f82: [0.85, 1.1],
	mercedes_g63: [0.7, 0.95],
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
		// ~0,8–1,1 g: carro de rua em piso seco
		expect(result.meanDeceleration).toBeGreaterThan(8);
		expect(result.meanDeceleration).toBeLessThan(11);
	});

	it("curva em regime (skidpad): aceleração lateral máxima de pneu de rua, sem rodar", async () => {
		const result = skidpadScenario(await createRapierSim(vehicleId), FRAME_DT);
		const [min, max] = LATERAL_GRIP[vehicleId];

		expect(result.nonFinite).toBe(false);
		expect(result.maxLateralAcceleration / G).toBeGreaterThan(min);
		expect(result.maxLateralAcceleration / G).toBeLessThan(max);
		expect(result.maxSideslip).toBeLessThan(0.35);
	});

	it("freio de mão em curva trava a traseira e ela escorrega (deriva acima do pico do pneu)", async () => {
		const handbrakeTurn = async (handbrake: boolean) => {
			const sim = await createRapierSim(vehicleId);
			const run = (seconds: number) => {
				for (let i = 0; i < Math.round(seconds / FRAME_DT); i++) sim.frame(FRAME_DT);
			};
			run(2);
			sim.input.throttle = true;
			for (let i = 0; i < 600 && sim.player.getTelemetry().forwardSpeed < 60 / 3.6; i++) sim.frame(FRAME_DT);
			sim.input.throttle = false;
			sim.input.left = true;
			run(0.3);
			sim.input.handbrake = handbrake;
			let rearSlipAngle = 0;
			let rearSlipRatio = 0;
			let sideslip = 0;
			for (let i = 0; i < Math.round(0.8 / FRAME_DT); i++) {
				sim.frame(FRAME_DT);
				const t = sim.player.getTelemetry();
				rearSlipAngle = Math.max(
					rearSlipAngle,
					Math.abs(t.wheels[2].slipAngle),
					Math.abs(t.wheels[3].slipAngle),
				);
				rearSlipRatio = Math.min(rearSlipRatio, t.wheels[2].slipRatio, t.wheels[3].slipRatio);
				sideslip = Math.max(sideslip, Math.abs(Math.atan2(t.lateralSpeed, Math.abs(t.forwardSpeed))));
			}
			return { rearSlipAngle, rearSlipRatio, sideslip };
		};
		const peakSlipAngle = new Tire(getVehicleDefinition(vehicleId)!.tire).peakSlipAngle;
		const without = await handbrakeTurn(false);
		const withHandbrake = await handbrakeTurn(true);

		expect(withHandbrake.rearSlipRatio).toBeLessThan(-0.9);
		expect(withHandbrake.rearSlipAngle).toBeGreaterThan(peakSlipAngle);
		expect(without.rearSlipAngle).toBeLessThan(peakSlipAngle);
		expect(withHandbrake.sideslip).toBeGreaterThan(2 * without.sideslip);
	});
});
