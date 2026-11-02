/** Controles contínuos do veículo (viram o InputFrame) */
export type DrivingControl = "throttle" | "brake" | "left" | "right" | "handbrake" | "boost";

/** Ações discretas, emitidas uma vez ao pressionar (InputManager.on) */
export type InputAction = "toggleDevMode" | "cycleCamera" | "selectVehicle1" | "selectVehicle2" | "resetVehicle";

export const INPUT_ACTIONS: readonly InputAction[] = [
	"toggleDevMode",
	"cycleCamera",
	"selectVehicle1",
	"selectVehicle2",
	"resetVehicle",
];

/** Mapeamento de dispositivos como dados. Teclas em minúsculas, como `KeyboardEvent.key`. */
export interface InputBindings {
	readonly keys: Readonly<Record<DrivingControl | InputAction, readonly string[]>>;
	/** Índices de botão no mapeamento padrão do Gamepad API */
	readonly gamepadButtons: Readonly<Partial<Record<"handbrake" | "boost" | InputAction, number>>>;
	readonly gamepad: {
		readonly steerAxis: number;
		readonly throttleButton: number;
		readonly brakeButton: number;
		/** Zona morta do analógico (reescalada) e limiar dos gatilhos (0–1) */
		readonly deadzone: number;
	};
}

export const DEFAULT_INPUT_BINDINGS: InputBindings = {
	keys: {
		toggleDevMode: ["f2"],
		cycleCamera: ["c", "v"],
		selectVehicle1: ["1"],
		selectVehicle2: ["2"],
		resetVehicle: ["r"],
		throttle: ["arrowup", "w"],
		brake: ["arrowdown", "s"],
		left: ["arrowleft", "a"],
		right: ["arrowright", "d"],
		handbrake: [" "],
		boost: ["shift"],
	},
	gamepadButtons: {
		handbrake: 0, // A / X
		boost: 5, // RB / R1
		cycleCamera: 3, // Y / Triângulo
		resetVehicle: 8, // Back / Share
		selectVehicle1: 14, // D-Pad esquerda
		selectVehicle2: 15, // D-Pad direita
	},
	gamepad: {
		steerAxis: 0, // analógico esquerdo, horizontal
		throttleButton: 7, // RT
		brakeButton: 6, // LT
		deadzone: 0.15,
	},
};
