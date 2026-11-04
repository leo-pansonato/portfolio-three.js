import { describe, expect, it } from "vitest";

import { VEHICLE_DEFINITIONS } from "../../src/data/vehicles";
import CriticalSpring from "../../src/ui/CriticalSpring";
import { formatGear, formatSpeed, leadingZeros, metersPerSecondToKmh, stableInteger } from "../../src/ui/format";
import {
	arcPath,
	buildTicks,
	createHudVehicleSpec,
	polarPoint,
	rpmFraction,
	rpmToAngleDeg,
	TACHOMETER_ARC,
} from "../../src/ui/gauge";
import HudStore from "../../src/ui/HudStore";
import { damp } from "../../src/ui/smoothing";
import { hudCssVariables } from "../../src/ui/tokens";

const bmw = createHudVehicleSpec(VEHICLE_DEFINITIONS.bmw_f82.powertrain);
const g63 = createHudVehicleSpec(VEHICLE_DEFINITIONS.mercedes_g63.powertrain);

function run(fps: number, seconds: number, stepFn: (dt: number) => number): number {
	const dt = 1 / fps;
	let value = 0;
	for (let i = 0; i < Math.round(seconds * fps); i++) value = stepFn(dt);
	return value;
}

describe("conta-giros: rpm → ângulo", () => {
	it("escala do mostrador cobre o corte com folga e a faixa vermelha começa na troca", () => {
		expect(bmw.dialMaxRpm).toBe(8000);
		expect(g63.dialMaxRpm).toBe(7000);
		expect(bmw.redlineRpm).toBe(VEHICLE_DEFINITIONS.bmw_f82.powertrain.upshiftRpm);
		expect(bmw.shiftAlertRpm).toBeLessThan(bmw.redlineRpm);
		expect(bmw.revLimitRpm).toBeLessThan(bmw.dialMaxRpm);
		expect(bmw.idleRpm).toBe(750);
	});

	it("0 rpm no início do arco, máximo no fim, linear no meio e limitado fora da escala", () => {
		const end = TACHOMETER_ARC.startDeg + TACHOMETER_ARC.sweepDeg;
		expect(rpmToAngleDeg(0, 8000)).toBe(TACHOMETER_ARC.startDeg);
		expect(rpmToAngleDeg(8000, 8000)).toBe(end);
		expect(rpmToAngleDeg(4000, 8000)).toBeCloseTo(0, 9);
		expect(rpmToAngleDeg(-500, 8000)).toBe(TACHOMETER_ARC.startDeg);
		expect(rpmToAngleDeg(12000, 8000)).toBe(end);
		expect(rpmFraction(Number.NaN, 8000)).toBe(0);
		expect(rpmFraction(1000, 0)).toBe(0);
	});

	it("polar com 0° nas 12 h, horário, y para baixo; arco grande acima de 180°", () => {
		expect(polarPoint(10, 0)).toEqual({ x: 0, y: -10 });
		expect(polarPoint(10, 90)).toEqual({ x: 10, y: 0 });
		expect(polarPoint(10, 180)).toEqual({ x: 0, y: 10 });
		expect(arcPath(10, -135, 135)).toContain(" 0 1 1 ");
		expect(arcPath(10, 100, 135)).toContain(" 0 0 1 ");
	});

	it("traços a cada 500 rpm, rótulos por milhar, vermelhos a partir da faixa", () => {
		const ticks = buildTicks(bmw);
		expect(ticks).toHaveLength(17);
		expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
		expect(ticks.filter((t) => t.inRedline).map((t) => t.rpm)).toEqual([7500, 8000]);
		for (let i = 1; i < ticks.length; i++) expect(ticks[i].angleDeg).toBeGreaterThan(ticks[i - 1].angleDeg);
	});
});

describe("suavização independente do FPS", () => {
	it("damp: 30, 60 e 144 FPS chegam ao mesmo valor", () => {
		const values = [30, 60, 144].map((fps) => {
			let x = 0;
			return run(fps, 0.5, (dt) => (x = damp(x, 100, 10, dt)));
		});
		expect(values[0]).toBeCloseTo(100 * (1 - Math.exp(-5)), 9);
		expect(values[1]).toBeCloseTo(values[0], 9);
		expect(values[2]).toBeCloseTo(values[0], 9);
	});

	it("mola crítica: mesmo resultado em 30, 60 e 144 FPS, sem ultrapassar o alvo", () => {
		const results = [30, 60, 144].map((fps) => {
			const spring = new CriticalSpring(16, 750);
			let max = 0;
			const value = run(fps, 1 / 6, (dt) => {
				const v = spring.step(7000, dt);
				max = Math.max(max, v);
				return v;
			});
			return { value, max, velocity: spring.velocity };
		});
		for (const r of results) {
			expect(r.value).toBeCloseTo(results[0].value, 6);
			expect(r.velocity).toBeCloseTo(results[0].velocity, 4);
			expect(r.max).toBeLessThanOrEqual(7000);
		}
		const omegaT = 16 / 6;
		expect(results[0].value).toBeCloseTo(7000 - 6250 * (1 + omegaT) * Math.exp(-omegaT), 6);
	});

	it("mola crítica: passo nulo ou negativo não altera o estado; reset zera a velocidade", () => {
		const spring = new CriticalSpring(16, 1000);
		spring.step(5000, 0.05);
		const before = spring.value;
		expect(spring.step(5000, 0)).toBe(before);
		expect(spring.step(5000, -1)).toBe(before);
		spring.reset(2000);
		expect(spring.value).toBe(2000);
		expect(spring.velocity).toBe(0);
	});
});

describe("formatação", () => {
	it("marcha: R na ré, N no ponto morto, número à frente", () => {
		expect(formatGear(-1)).toBe("R");
		expect(formatGear(0)).toBe("N");
		expect(formatGear(1)).toBe("1");
		expect(formatGear(9)).toBe("9");
	});

	it("velocidade em km/h inteira, não negativa, com zeros apagados até 3 algarismos", () => {
		expect(metersPerSecondToKmh(10)).toBeCloseTo(36, 12);
		expect(formatSpeed(87.6)).toBe("88");
		expect(formatSpeed(-12.2)).toBe("12");
		expect(leadingZeros("0", 3)).toBe("00");
		expect(leadingZeros("88", 3)).toBe("0");
		expect(leadingZeros("250", 3)).toBe("");
	});

	it("número estável: não alterna entre vizinhos com ruído em torno do meio inteiro", () => {
		let shown = 100;
		const changes = new Set<number>();
		for (let i = 0; i < 200; i++) {
			const noisy = 100.5 + 0.25 * Math.sin(i * 1.7);
			shown = stableInteger(noisy, shown, 0.3);
			changes.add(shown);
		}
		expect([...changes]).toEqual([100]);
		expect(stableInteger(101.81, 100, 0.3)).toBe(102);
		expect(stableInteger(Number.NaN, 42, 0.3)).toBe(42);
	});
});

describe("HudStore", () => {
	it("render só em mudança discreta: marcha constante não notifica, troca notifica uma vez", () => {
		const store = new HudStore();
		let renders = 0;
		store.subscribe(() => renders++);
		store.setVehicle(bmw);
		expect(renders).toBe(1);
		const initial = store.getState();

		for (let i = 0; i < 120; i++) {
			store.frame.engineRpm = 3000 + i * 10;
			store.frame.speedKmh = i;
			store.publish(1 / 60);
		}
		expect(renders).toBe(1);
		expect(store.getState()).toBe(initial);

		store.frame.gear = 2;
		store.publish(1 / 60);
		store.publish(1 / 60);
		expect(renders).toBe(2);
		expect(store.getState().gear).toBe(2);
		expect(store.getState().previousGear).toBe(1);

		store.setVehicle(bmw);
		store.setVisible(true);
		expect(renders).toBe(2);
	});

	it("ouvintes de quadro recebem o snapshot e param após cancelar", () => {
		const store = new HudStore();
		const seen: number[] = [];
		const off = store.onFrame((frame, dt) => seen.push(frame.engineRpm * dt));
		store.frame.engineRpm = 6000;
		store.publish(0.5);
		off();
		store.publish(0.5);
		expect(seen).toEqual([3000]);
	});
});

describe("tokens", () => {
	it("geram variáveis CSS com tamanhos em unidades do HUD", () => {
		const vars = hudCssVariables();
		expect(vars["--hud-color-redline"]).toMatch(/^#/);
		expect(vars["--hud-size-tachometer"]).toBe("calc(var(--hud-u) * 300)");
		expect(vars["--hud-ease-out"]).toMatch(/^cubic-bezier/);
		expect(vars["--hud-gear-ms"]).toMatch(/ms$/);
	});
});
