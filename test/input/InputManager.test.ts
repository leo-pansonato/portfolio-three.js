import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputAction } from "../../src/input/InputBindings";
import InputManager from "../../src/input/InputManager";

type Listener = (e: any) => void;

class FakeTarget {
	private listeners = new Map<string, Listener[]>();
	addEventListener(type: string, listener: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener);
		this.listeners.set(type, list);
	}
	dispatch(type: string, event: object = {}): void {
		for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {}, ...event });
	}
}

interface FakePad {
	index: number;
	id: string;
	mapping: string;
	axes: number[];
	buttons: { pressed: boolean; value: number }[];
}

function createPad(): FakePad {
	return {
		index: 0,
		id: "pad",
		mapping: "standard",
		axes: [0, 0, 0, 0],
		buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
	};
}

let doc: FakeTarget & { body: object; pointerLockElement: object | null };
let pads: (FakePad | null)[];

beforeEach(() => {
	doc = Object.assign(new FakeTarget(), { body: {}, pointerLockElement: null });
	pads = [];
	vi.stubGlobal("document", doc);
	vi.stubGlobal("window", new FakeTarget());
	vi.stubGlobal("navigator", { getGamepads: () => pads });
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const press = (key: string) => doc.dispatch("keydown", { key });
const release = (key: string) => doc.dispatch("keyup", { key });

describe("InputManager — InputFrame", () => {
	it("teclado: valores digitais; direita vence quando as duas direções estão seguradas", () => {
		const input = new InputManager();
		press("W");
		press("a");
		press(" ");
		press("Shift");
		input.update();
		expect(input.frame).toEqual({ throttle: 1, brake: 0, steer: -1, handbrake: true, boost: true });

		press("ArrowRight");
		input.update();
		expect(input.frame.steer).toBe(1);

		for (const key of ["W", "a", " ", "Shift", "ArrowRight"]) release(key);
		input.update();
		expect(input.frame).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });
	});

	it("gamepad: zona morta reescalada no volante, limiar nos gatilhos, botões contínuos", () => {
		const pad = createPad();
		pads = [pad];
		const input = new InputManager();

		pad.axes[0] = -0.575; // (0,575 − 0,15) / 0,85 = 0,5
		pad.buttons[7].value = 0.6;
		pad.buttons[6].value = 0.1; // abaixo do limiar
		pad.buttons[0].pressed = true;
		input.update();
		expect(input.frame.steer).toBeCloseTo(-0.5, 10);
		expect(input.frame.throttle).toBe(0.6);
		expect(input.frame.brake).toBe(0);
		expect(input.frame.handbrake).toBe(true);

		pad.axes[0] = 0.1;
		input.update();
		expect(input.frame.steer).toBe(0);
	});

	it("teclado sobrescreve o gamepad", () => {
		const pad = createPad();
		pads = [pad];
		const input = new InputManager();
		pad.axes[0] = -1;
		pad.buttons[7].value = 0.3;
		press("d");
		press("w");
		input.update();
		expect(input.frame.steer).toBe(1);
		expect(input.frame.throttle).toBe(1);
	});

	it("mouse: delta acumulado entre quadros e zerado a cada update", () => {
		const input = new InputManager();
		doc.dispatch("mousemove", { movementX: 3, movementY: -2 });
		doc.dispatch("mousemove", { movementX: 4, movementY: 1 });
		input.update();
		expect(input.look.deltaX).toBe(7);
		expect(input.look.deltaY).toBe(-1);
		input.update();
		expect(input.look.deltaX).toBe(0);
	});
});

describe("InputManager — analógico da câmera", () => {
	it("taxa em rad/s com zona morta radial e curva quadrática, sem mexer na direção", () => {
		const pad = createPad();
		pads = [pad];
		const input = new InputManager();

		pad.axes[2] = 0.575; // (0,575 − 0,15) / 0,85 = 0,5 → 0,5² · 3 = 0,75 rad/s
		input.update();
		expect(input.look.yawRate).toBeCloseTo(0.75, 10);
		expect(input.look.pitchRate).toBeCloseTo(0, 10);
		expect(input.frame.steer).toBe(0);

		pad.axes[2] = 0;
		pad.axes[3] = -1; // para cima no fim de curso
		input.update();
		expect(input.look.pitchRate).toBeCloseTo(3, 10);
		expect(input.look.yawRate).toBeCloseTo(0, 10);

		pad.axes[3] = 0.1;
		pad.axes[2] = 0.1; // |(0,1; 0,1)| < 0,15
		input.update();
		expect(input.look.yawRate).toBe(0);
		expect(input.look.pitchRate).toBe(0);
	});

	it("direção e câmera ao mesmo tempo, e o tempo desde o movimento zera com o analógico", () => {
		const pad = createPad();
		pads = [pad];
		const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const input = new InputManager();
		input.update();
		now.mockReturnValue(12_000);
		input.update();
		expect(input.look.secondsSinceMove).toBeGreaterThanOrEqual(2);

		pad.axes[0] = 1;
		pad.axes[2] = -1;
		input.update();
		expect(input.frame.steer).toBe(1);
		expect(input.look.yawRate).toBeCloseTo(-3, 10);
		expect(input.look.secondsSinceMove).toBe(0);
	});

	it("volante sem mapeamento padrão não move a câmera; um controle padrão ao lado move", () => {
		const wheel = { ...createPad(), id: "wheel", mapping: "" };
		wheel.axes[2] = 1;
		pads = [wheel];
		const input = new InputManager();
		input.update();
		expect(input.look.yawRate).toBe(0);

		const pad = { ...createPad(), index: 1 };
		pad.axes[2] = 1;
		pads = [wheel, pad];
		input.update();
		expect(input.look.yawRate).toBeCloseTo(3, 10);
	});
});

describe("InputManager — ações discretas", () => {
	function record(input: InputManager): InputAction[] {
		const fired: InputAction[] = [];
		for (const action of [
			"toggleDevMode",
			"cycleCamera",
			"selectVehicle1",
			"selectVehicle2",
			"resetVehicle",
		] as const) {
			input.on(action, () => fired.push(action));
		}
		return fired;
	}

	it("teclas emitem uma vez por pressionamento, sem repetição automática", () => {
		const input = new InputManager();
		const fired = record(input);
		press("c");
		press("c");
		release("c");
		press("V");
		press("F2");
		press("1");
		press("2");
		press("r");
		press("w");
		expect(fired).toEqual([
			"cycleCamera",
			"cycleCamera",
			"toggleDevMode",
			"selectVehicle1",
			"selectVehicle2",
			"resetVehicle",
		]);
	});

	it("botões do gamepad emitem na borda de subida, durante o update", () => {
		const pad = createPad();
		pads = [pad];
		const input = new InputManager();
		const fired = record(input);
		pad.buttons[3].pressed = true;
		input.update();
		input.update();
		pad.buttons[3].pressed = false;
		input.update();
		pad.buttons[8].pressed = true;
		pad.buttons[14].pressed = true;
		input.update();
		expect(fired).toEqual(["cycleCamera", "resetVehicle", "selectVehicle1"]);
	});
});

describe("InputManager — zoom e reset da câmera", () => {
	it("roda: entalhes somados até o update, limitados a ±1 por evento, e zerados depois", () => {
		const input = new InputManager();
		doc.dispatch("wheel", { deltaY: 100, deltaMode: 0 });
		doc.dispatch("wheel", { deltaY: 40, deltaMode: 0 });
		doc.dispatch("wheel", { deltaY: -500, deltaMode: 0 });
		input.update();
		expect(input.look.zoomSteps).toBeCloseTo(0.4, 10);
		input.update();
		expect(input.look.zoomSteps).toBe(0);

		doc.dispatch("wheel", { deltaY: 3, deltaMode: 1 }); // linhas (Firefox)
		input.update();
		expect(input.look.zoomSteps).toBeCloseTo(0.99, 10);
	});

	it("clique da roda emite resetCamera; os outros botões não", () => {
		const input = new InputManager();
		const reset = vi.fn();
		input.on("resetCamera", reset);
		doc.dispatch("mousedown", { button: 0 });
		doc.dispatch("mousedown", { button: 2 });
		expect(reset).not.toHaveBeenCalled();
		doc.dispatch("mousedown", { button: 1 });
		expect(reset).toHaveBeenCalledTimes(1);
	});
});

describe("módulo de input desacoplado", () => {
	it("src/input não importa Game, Player nem CameraController", () => {
		const dir = join(__dirname, "../../src/input");
		for (const file of readdirSync(dir)) {
			const source = readFileSync(join(dir, file), "utf8");
			expect(source, file).not.toMatch(/from\s+"[^"]*(main|components\/|Player|CameraController)[^"]*"/);
		}
	});
});
