import { describe, expect, it } from "vitest";
import EngineEventDetector, { EngineEventName } from "../../src/audio/EngineEventDetector";

const FRAME = 1 / 60;

/** Roda quadros com marcha, rpm e carga constantes e devolve os eventos */
function run(
	detector: EngineEventDetector,
	frames: number,
	gear: number,
	rpm: number,
	load: number,
): EngineEventName[] {
	const events: EngineEventName[] = [];
	for (let i = 0; i < frames; i++) {
		const event = detector.update(FRAME, gear, rpm, load);
		if (event) events.push(event);
	}
	return events;
}

describe("eventos do motor", () => {
	it("troca para cima e para baixo pela marcha; ré e ponto morto não contam", () => {
		const detector = new EngineEventDetector();
		detector.reset(1);
		expect(run(detector, 30, 2, 5000, 1)).toEqual(["upshift"]);
		expect(run(detector, 30, 1, 4000, 0)).toEqual(["downshift"]);
		expect(run(detector, 30, -1, 2000, 0.5)).toEqual([]);
		expect(run(detector, 30, 1, 2000, 0.5)).toEqual([]);
		expect(run(detector, 30, 0, 1000, 0)).toEqual([]);
		expect(run(detector, 30, 1, 1000, 0.5)).toEqual([]);
	});

	it("redução acelerando (kickdown) não toca o blip de redução", () => {
		const detector = new EngineEventDetector();
		detector.reset(3);
		expect(run(detector, 30, 2, 4000, 1)).toEqual([]);
		expect(run(detector, 30, 1, 3000, 0.2)).toEqual(["downshift"]);
	});

	it("tirar o pé rápido em rotação alta: corte ou estalos conforme o sorteio", () => {
		const lift = new EngineEventDetector(() => 0.9);
		lift.reset(3);
		run(lift, 30, 3, 6000, 1);
		expect(run(lift, 30, 3, 5900, 0)).toEqual(["lift"]);

		const pops = new EngineEventDetector(() => 0.1);
		pops.reset(3);
		run(pops, 30, 3, 6000, 1);
		expect(run(pops, 30, 3, 5900, 0)).toEqual(["pops"]);
	});

	it("rotação média só dá estalos; rotação baixa e soltar devagar não dão nada", () => {
		const detector = new EngineEventDetector(() => 0.9);
		detector.reset(1);
		run(detector, 30, 1, 3000, 1);
		expect(run(detector, 30, 1, 2900, 0)).toEqual(["pops"]);

		run(detector, 30, 1, 1500, 1);
		expect(run(detector, 30, 1, 1400, 0)).toEqual([]);

		run(detector, 30, 1, 5000, 1);
		run(detector, 30, 1, 5000, 0.3);
		expect(run(detector, 30, 1, 4900, 0)).toEqual([]);
	});

	it("o corte de acelerador da troca não conta como tirar o pé", () => {
		const detector = new EngineEventDetector(() => 0.1);
		detector.reset(2);
		run(detector, 30, 2, 7000, 1);
		expect(run(detector, 10, 3, 5200, 0)).toEqual(["upshift"]);
		expect(run(detector, 30, 3, 5300, 1)).toEqual([]);
	});

	it("intervalo mínimo entre eventos", () => {
		const detector = new EngineEventDetector();
		detector.reset(1);
		expect(detector.update(FRAME, 2, 6000, 1)).toBe("upshift");
		expect(detector.update(FRAME, 3, 6000, 1)).toBeNull();
		expect(run(detector, 30, 3, 6000, 1)).toEqual([]);
		expect(run(detector, 30, 4, 6000, 1)).toEqual(["upshift"]);
	});
});
