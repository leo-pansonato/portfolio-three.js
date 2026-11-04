/** Controles contínuos do veículo (viram o InputFrame) */
export type DrivingControl = "throttle" | "brake" | "left" | "right" | "handbrake" | "boost";

/** Ações discretas, emitidas uma vez ao pressionar (InputManager.on) */
export type InputAction =
	"toggleDevMode" | "cycleCamera" | "resetCamera" | "selectVehicle1" | "selectVehicle2" | "resetVehicle";

export const INPUT_ACTIONS: readonly InputAction[] = [
	"toggleDevMode",
	"cycleCamera",
	"resetCamera",
	"selectVehicle1",
	"selectVehicle2",
	"resetVehicle",
];

/** Mapeamento de dispositivos como dados. Teclas em minúsculas, como `KeyboardEvent.key`. */
export interface InputBindings {
	readonly keys: Readonly<Record<DrivingControl | InputAction, readonly string[]>>;
	/** Índices de botão no mapeamento padrão do Gamepad API */
	readonly gamepadButtons: Readonly<Partial<Record<"handbrake" | "boost" | InputAction, number>>>;
	/** Botões do mouse (`MouseEvent.button`) que emitem ações */
	readonly mouseButtons: Readonly<Partial<Record<InputAction, number>>>;
	readonly gamepad: {
		readonly steerAxis: number;
		readonly throttleButton: number;
		readonly brakeButton: number;
		/** Zona morta do analógico (reescalada) e limiar dos gatilhos (0–1) */
		readonly deadzone: number;
		/** Eixos do analógico da câmera (horizontal: +1 direita; vertical: +1 baixo) */
		readonly lookAxisX: number;
		readonly lookAxisY: number;
		/** Zona morta radial do analógico da câmera (0–1, reescalada) */
		readonly lookDeadzone: number;
		/** Expoente da curva de resposta depois da zona morta (1 = linear) */
		readonly lookExponent: number;
		/** Taxa com o analógico no fim de curso (rad/s) */
		readonly lookMaxRate: number;
		/** Câmera só de controles com `mapping === "standard"` (volantes como o G29 ficam de fora) */
		readonly lookStandardMappingOnly: boolean;
	};
}

export const DEFAULT_INPUT_BINDINGS: InputBindings = {
	keys: {
		toggleDevMode: ["f2"],
		cycleCamera: ["c", "v"],
		resetCamera: [],
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
		resetCamera: 11, // R3
		resetVehicle: 8, // Back / Share
		selectVehicle1: 14, // D-Pad esquerda
		selectVehicle2: 15, // D-Pad direita
	},
	mouseButtons: {
		resetCamera: 1, // clique da roda
	},
	gamepad: {
		steerAxis: 0, // analógico esquerdo, horizontal
		throttleButton: 7, // RT
		brakeButton: 6, // LT
		deadzone: 0.15,
		lookAxisX: 2, // analógico direito, horizontal
		lookAxisY: 3, // analógico direito, vertical
		lookDeadzone: 0.15,
		lookExponent: 2,
		lookMaxRate: 3,
		lookStandardMappingOnly: true,
	},
};
