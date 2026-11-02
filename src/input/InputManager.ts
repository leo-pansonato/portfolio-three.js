import { DEFAULT_INPUT_BINDINGS, DrivingControl, INPUT_ACTIONS, InputAction, InputBindings } from "./InputBindings";
import { createInputFrame, createLookInput, InputFrame, LookInput } from "./InputFrame";

type ActionHandler = () => void;

/**
 * Lê teclado, mouse e gamepad. Produz um InputFrame e um LookInput por quadro (update)
 * e emite ações discretas para quem as assinou com on(); não conhece quem as trata.
 */
export default class InputManager {
	/** Comandos do motorista deste quadro (reescritos em update) */
	readonly frame: InputFrame = createInputFrame();
	/** Olhar livre do mouse deste quadro (reescrito em update) */
	readonly look: LookInput = createLookInput();

	private readonly bindings: InputBindings;
	private readonly handlers = new Map<InputAction, ActionHandler[]>();
	private readonly actionByKey = new Map<string, InputAction>();
	private readonly gamepadActions: ReadonlyArray<readonly [InputAction, number]>;
	private readonly heldKeys = new Set<string>();

	private mouseDeltaX = 0; // px acumulados desde o último update
	private mouseDeltaY = 0;
	private pointerLocked = false;
	private lastMoveTime = Date.now(); // ms

	private gamepadIndex = -1;
	private gamepadPrevButtons: boolean[] = [];

	// valores analógicos 0–1 do quadro
	private throttle = 0;
	private brake = 0;
	private left = 0;
	private right = 0;

	constructor(bindings: InputBindings = DEFAULT_INPUT_BINDINGS) {
		this.bindings = bindings;

		for (const action of INPUT_ACTIONS) {
			this.handlers.set(action, []);
			for (const key of bindings.keys[action]) {
				this.actionByKey.set(key.toLowerCase(), action);
			}
		}

		const gamepadActions: [InputAction, number][] = [];
		for (const [name, button] of Object.entries(bindings.gamepadButtons)) {
			if (button !== undefined && this.handlers.has(name as InputAction)) {
				gamepadActions.push([name as InputAction, button]);
			}
		}
		this.gamepadActions = gamepadActions;

		this.setupEventListeners();
	}

	/** Assina uma ação discreta; o handler roda uma vez por pressionamento */
	on(action: InputAction, handler: ActionHandler): void {
		this.handlers.get(action)!.push(handler);
	}

	private emit(action: InputAction): void {
		for (const handler of this.handlers.get(action)!) {
			handler();
		}
	}

	private setupEventListeners(): void {
		document.addEventListener("keydown", (e) => this.handleKeyDown(e));
		document.addEventListener("keyup", (e) => this.heldKeys.delete(e.key.toLowerCase()));
		document.addEventListener("mousemove", (e) => this.handleMouseMove(e));
		document.addEventListener("contextmenu", (e) => e.preventDefault());

		document.addEventListener("click", () => {
			if (document.pointerLockElement !== document.body) {
				document.body.requestPointerLock();
			} else {
				document.exitPointerLock();
			}
		});

		document.addEventListener("pointerlockchange", () => {
			this.pointerLocked = document.pointerLockElement === document.body;
		});

		window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
			console.log(`[Gamepad] Conectado: ${e.gamepad.id}`);
			this.gamepadIndex = e.gamepad.index;
			this.gamepadPrevButtons = new Array(e.gamepad.buttons.length).fill(false);
		});

		window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
			console.log(`[Gamepad] Desconectado: ${e.gamepad.id}`);
			if (e.gamepad.index === this.gamepadIndex) {
				this.gamepadIndex = -1;
				this.gamepadPrevButtons = [];
			}
		});
	}

	/**
	 * Gamepad atual; o polling acha controles já conectados antes do carregamento da página
	 */
	private getGamepad(): Gamepad | null {
		const gamepads = navigator.getGamepads();

		if (this.gamepadIndex >= 0 && gamepads[this.gamepadIndex]) {
			return gamepads[this.gamepadIndex];
		}

		for (let i = 0; i < gamepads.length; i++) {
			const gamepad = gamepads[i];
			if (gamepad) {
				if (this.gamepadIndex !== i) {
					console.log(`[Gamepad] Detectado via polling: ${gamepad.id}`);
					this.gamepadIndex = i;
					this.gamepadPrevButtons = new Array(gamepad.buttons.length).fill(false);
				}
				return gamepad;
			}
		}

		return null;
	}

	/**
	 * Lê os dispositivos e reescreve frame e look; chamar uma vez por quadro, antes da física
	 */
	update(): void {
		this.throttle = 0;
		this.brake = 0;
		this.left = 0;
		this.right = 0;

		const gamepad = this.getGamepad();
		if (gamepad) {
			this.processGamepad(gamepad);
		}

		// teclado sobrescreve o gamepad
		this.processKeyboard();

		const frame = this.frame;
		frame.throttle = this.throttle;
		frame.brake = this.brake;
		frame.steer = this.right - this.left;
		frame.handbrake = this.isControlHeld("handbrake");
		frame.boost = this.isControlHeld("boost");

		const look = this.look;
		look.deltaX = this.mouseDeltaX;
		look.deltaY = this.mouseDeltaY;
		look.pointerLocked = this.pointerLocked;
		look.secondsSinceMove = (Date.now() - this.lastMoveTime) / 1000;
		this.mouseDeltaX = 0;
		this.mouseDeltaY = 0;
	}

	private processGamepad(gamepad: Gamepad): void {
		const buttons = gamepad.buttons;
		const axes = gamepad.axes;
		const config = this.bindings.gamepad;

		// ações discretas na borda de subida
		for (const [action, button] of this.gamepadActions) {
			if (button >= buttons.length) continue;
			if (buttons[button].pressed && !this.gamepadPrevButtons[button]) {
				this.emit(action);
			}
		}

		for (let i = 0; i < buttons.length; i++) {
			this.gamepadPrevButtons[i] = buttons[i].pressed;
		}

		if (axes.length > config.steerAxis) {
			const steer = this.applyDeadzone(axes[config.steerAxis]);
			if (steer < 0) {
				this.left = -steer;
			} else if (steer > 0) {
				this.right = steer;
			}
		}

		if (buttons.length > Math.max(config.throttleButton, config.brakeButton)) {
			const throttle = buttons[config.throttleButton].value;
			const brake = buttons[config.brakeButton].value;
			if (throttle > config.deadzone) this.throttle = throttle;
			if (brake > config.deadzone) this.brake = brake;
		}
	}

	private processKeyboard(): void {
		if (this.isKeyHeld("throttle")) this.throttle = 1;
		if (this.isKeyHeld("brake")) this.brake = 1;
		if (this.isKeyHeld("left")) {
			this.left = 1;
			this.right = 0;
		}
		if (this.isKeyHeld("right")) {
			this.right = 1;
			this.left = 0;
		}
	}

	private isKeyHeld(control: DrivingControl): boolean {
		const keys = this.bindings.keys[control];
		for (let i = 0; i < keys.length; i++) {
			if (this.heldKeys.has(keys[i])) return true;
		}
		return false;
	}

	/** Tecla segurada ou botão do gamepad pressionado no último update */
	private isControlHeld(control: "handbrake" | "boost"): boolean {
		if (this.isKeyHeld(control)) return true;
		const button = this.bindings.gamepadButtons[control];
		return button !== undefined && this.gamepadPrevButtons[button] === true;
	}

	private applyDeadzone(value: number): number {
		const deadzone = this.bindings.gamepad.deadzone;
		if (Math.abs(value) < deadzone) return 0;
		const sign = value > 0 ? 1 : -1;
		return (sign * (Math.abs(value) - deadzone)) / (1 - deadzone);
	}

	private handleKeyDown(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		if (this.heldKeys.has(key)) return;
		this.heldKeys.add(key);

		const action = this.actionByKey.get(key);
		if (action) this.emit(action);
	}

	private handleMouseMove(e: MouseEvent): void {
		this.mouseDeltaX += e.movementX;
		this.mouseDeltaY += e.movementY;
		if (this.pointerLocked) {
			this.lastMoveTime = Date.now();
		}
	}
}
