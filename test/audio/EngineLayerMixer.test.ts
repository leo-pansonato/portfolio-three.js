import { describe, expect, it } from "vitest";
import EngineLayerMixer, { EngineLayer, parseEngineBank } from "../../src/audio/EngineLayerMixer";

const layer = (rpm: number, load: EngineLayer["load"]): EngineLayer => ({ rpm, load, loopStart: 1, loopEnd: 2 });
const LAYERS: EngineLayer[] = [
	layer(1000, "idle"),
	layer(2000, "on"),
	layer(3000, "on"),
	layer(4000, "on"),
	layer(2000, "off"),
	layer(3000, "off"),
];

function power(gains: Float64Array): number {
	return gains.reduce((sum, g) => sum + g * g, 0);
}

describe("mistura das camadas do motor", () => {
	it("na rpm de uma camada só ela soa, na rotação gravada", () => {
		const mixer = new EngineLayerMixer(LAYERS);
		mixer.update(3000, 1);
		[0, 0, 1, 0, 0, 0].forEach((gain, i) => expect(mixer.gains[i]).toBeCloseTo(gain, 12));
		expect(mixer.rates[2]).toBe(1);
		expect(mixer.rates[1]).toBe(1.5);
	});

	it("entre camadas: potência constante, mais peso na mais próxima em log-rpm", () => {
		const mixer = new EngineLayerMixer(LAYERS);
		for (const rpm of [1100, 1500, 2449, 2900, 3500]) {
			mixer.update(rpm, 1);
			expect(power(mixer.gains)).toBeCloseTo(1, 12);
		}
		mixer.update(Math.sqrt(2000 * 3000), 1);
		expect(mixer.gains[1]).toBeCloseTo(mixer.gains[2], 12);
		mixer.update(2200, 1);
		expect(mixer.gains[1]).toBeGreaterThan(mixer.gains[2]);
	});

	it("carga faz crossfade de potência constante entre os conjuntos; a lenta entra nos dois", () => {
		const mixer = new EngineLayerMixer(LAYERS);
		mixer.update(2000, 0);
		expect(mixer.gains[4]).toBeCloseTo(1, 12);
		expect(mixer.gains[1]).toBeCloseTo(0, 12);
		mixer.update(2000, 0.5);
		expect(mixer.gains[1]).toBeCloseTo(Math.SQRT1_2, 12);
		expect(mixer.gains[4]).toBeCloseTo(Math.SQRT1_2, 12);
		expect(power(mixer.gains)).toBeCloseTo(1, 12);
		for (const load of [0, 0.3, 1]) {
			mixer.update(900, load);
			expect(mixer.gains[0]).toBeCloseTo(1, 12);
		}
	});

	it("fora da faixa gravada fica na camada extrema com playbackRate limitado", () => {
		const mixer = new EngineLayerMixer(LAYERS);
		mixer.update(7600, 1);
		expect(mixer.gains[3]).toBe(1);
		expect(mixer.rates[3]).toBe(1.9);
		mixer.update(7600, 0);
		expect(mixer.gains[5]).toBe(1);
		expect(mixer.rates[5]).toBe(2.5);
		mixer.update(600, 1);
		expect(mixer.rates[0]).toBe(0.6);
	});
});

describe("manifesto do banco de motor", () => {
	it("aceita o formato gerado pela ferramenta", () => {
		const bank = parseEngineBank({ audio: "x.m4a", layers: LAYERS });
		expect(bank.layers).toHaveLength(6);
	});

	it("rejeita manifesto incompleto ou camada inválida", () => {
		expect(() => parseEngineBank(null)).toThrow();
		expect(() => parseEngineBank({ audio: "x.m4a", layers: [layer(1000, "idle"), layer(2000, "on")] })).toThrow(
			/com e sem carga/,
		);
		expect(() =>
			parseEngineBank({ audio: "x.m4a", layers: [...LAYERS, { ...layer(2000, "on"), loopEnd: 0 }] }),
		).toThrow();
	});
});
