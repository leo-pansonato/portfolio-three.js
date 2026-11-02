import GameComponent from "../components/GameComponent";
import { devMode } from "../managers/DevModeManager";
import { createInputFrame, createLookInput, InputFrame, LookInput } from "./InputFrame";

export default class InputManager extends GameComponent {
	private static readonly GAMEPAD_BUTTONS: ReadonlyArray<readonly [string, number]> = [
		["VEHICLE_HANDBRAKE", 0], // A / X
		["VEHICLE_BOOST", 5], // RB / R1
		["CYCLE_CAMERA_MODE", 3], // Y / Triangle
		["RESET_CAR", 8], // Back / Share
		["SELECT_VEHICLE_1", 14], // D-Pad Left
		["SELECT_VEHICLE_2", 15], // D-Pad Right
	];
	private static readonly GAMEPAD_BUTTON_BY_ACTION = new Map(InputManager.GAMEPAD_BUTTONS);

	/** Comandos do motorista deste quadro (reescritos em update) */
	readonly frame: InputFrame = createInputFrame();
	/** Olhar livre do mouse deste quadro (reescrito em update) */
	readonly look: LookInput = createLookInput();

	private game: any;
	private keys: { [key: string]: boolean } = {};

	private mouse = {
		position: { x: 0, y: 0 },
		delta: { x: 0, y: 0 },
		isLeftDown: false,
		isRightDown: false,
		isLocked: false,
		lastInputTime: Date.now(),
	};

	// Gamepad
	private gamepadIndex: number = -1;
	private gamepadDeadzone: number = 0.15;
	private gamepadPrevButtons: boolean[] = [];

	// Valores analógicos (0 a 1)
	private analogValues = {
		VEHICLE_THROTTLE: 0,
		VEHICLE_BRAKE: 0,
		VEHICLE_LEFT: 0,
		VEHICLE_RIGHT: 0,
	};

	private keyBindings: { [action: string]: string[] };
	private actions: { [action: string]: () => void };
	private keyMap: { [key: string]: string } = {};

	constructor(game: any) {
		super();
		this.game = game;

		this.keyBindings = {
			TOGGLE_DEV_MODE: ["f2"],
			CYCLE_CAMERA_MODE: ["c", "v"],
			SELECT_VEHICLE_1: ["1"],
			SELECT_VEHICLE_2: ["2"],
			RESET_CAR: ["r"],
			VEHICLE_THROTTLE: ["arrowup", "w"],
			VEHICLE_BRAKE: ["arrowdown", "s"],
			VEHICLE_LEFT: ["arrowleft", "a"],
			VEHICLE_RIGHT: ["arrowright", "d"],
			VEHICLE_HANDBRAKE: [" "],
			VEHICLE_BOOST: ["shift"],
		};

		this.actions = {
			TOGGLE_DEV_MODE: () => devMode.toggle(),
			CYCLE_CAMERA_MODE: () => this.game.cameraController.cycleCameraMode(),
			SELECT_VEHICLE_1: () => this.game.player.changeVehicle("bmw_f82"),
			SELECT_VEHICLE_2: () => this.game.player.changeVehicle("mercedes_g63"),
			RESET_CAR: () => this.game.player.resetCar(),
		};

		this.generateKeyMap();
		this.setupEventListeners();
	}

	setupEventListeners(): void {
		document.addEventListener("keydown", (e) => this.handleKeyDown(e));
		document.addEventListener("keyup", (e) => this.handleKeyUp(e));
		document.addEventListener("mousedown", (e) => this.handleMouseDown(e));
		document.addEventListener("mouseup", (e) => this.handleMouseUp(e));
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
			this.mouse.isLocked = document.pointerLockElement === document.body;
		});

		// Gamepad events (para quando conectar/desconectar)
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
	 * Retorna o gamepad atual (com polling para detectar gamepads já conectados)
	 */
	private getGamepad(): Gamepad | null {
		const gamepads = navigator.getGamepads();
		
		// Se já temos um gamepad, retorna ele
		if (this.gamepadIndex >= 0 && gamepads[this.gamepadIndex]) {
			return gamepads[this.gamepadIndex];
		}
		
		// Procura por qualquer gamepad conectado (resolve o problema do F5)
		for (let i = 0; i < gamepads.length; i++) {
			if (gamepads[i]) {
				if (this.gamepadIndex !== i) {
					console.log(`[Gamepad] Detectado via polling: ${gamepads[i]!.id}`);
					this.gamepadIndex = i;
					this.gamepadPrevButtons = new Array(gamepads[i]!.buttons.length).fill(false);
				}
				return gamepads[i];
			}
		}
		
		return null;
	}

	/**
	 * Atualiza todos os inputs - deve ser chamado a cada frame
	 */
	update(): void {
		const gamepad = this.getGamepad();
		
		// Reset dos valores analógicos
		this.analogValues.VEHICLE_THROTTLE = 0;
		this.analogValues.VEHICLE_BRAKE = 0;
		this.analogValues.VEHICLE_LEFT = 0;
		this.analogValues.VEHICLE_RIGHT = 0;

		// Processa gamepad (se conectado)
		if (gamepad) {
			this.processGamepad(gamepad);
		}

		// Teclado sobrescreve gamepad
		this.processKeyboard();

		const frame = this.frame;
		frame.throttle = this.getThrottle();
		frame.brake = this.getBrake();
		frame.steer = this.getSteer();
		frame.handbrake = this.isActionActive("VEHICLE_HANDBRAKE");
		frame.boost = this.isActionActive("VEHICLE_BOOST");

		const look = this.look;
		look.deltaX = this.mouse.delta.x;
		look.deltaY = this.mouse.delta.y;
		look.pointerLocked = this.mouse.isLocked;
		look.secondsSinceMove = this.getTimeSinceLastInput();
		this.mouse.delta.x = 0;
		this.mouse.delta.y = 0;
	}

	private processGamepad(gamepad: Gamepad): void {
		const buttons = gamepad.buttons;
		const axes = gamepad.axes;

		// === BOTÕES (ações instantâneas) ===
		for (const [action, btnIndex] of InputManager.GAMEPAD_BUTTONS) {
			if (btnIndex >= buttons.length) continue;
			
			const isPressed = buttons[btnIndex].pressed;
			const wasPressed = this.gamepadPrevButtons[btnIndex] || false;
			
			// Edge detection - dispara ação apenas no momento do clique
			if (isPressed && !wasPressed && this.actions[action]) {
				this.actions[action]();
			}
		}

		// Atualiza estado anterior dos botões
		for (let i = 0; i < buttons.length; i++) {
			this.gamepadPrevButtons[i] = buttons[i].pressed;
		}

		// === EIXOS ANALÓGICOS ===
		
		// Direção (eixo 0 = analógico esquerdo horizontal)
		if (axes.length > 0) {
			const steer = this.applyDeadzone(axes[0]);
			if (steer < 0) {
				this.analogValues.VEHICLE_LEFT = Math.abs(steer);
			} else if (steer > 0) {
				this.analogValues.VEHICLE_RIGHT = steer;
			}
		}

		// Gatilhos (RT = acelerar, LT = frear)
		if (buttons.length > 7) {
			const rt = buttons[7].value; // RT
			const lt = buttons[6].value; // LT
			
			if (rt > this.gamepadDeadzone) {
				this.analogValues.VEHICLE_THROTTLE = rt;
			}
			if (lt > this.gamepadDeadzone) {
				this.analogValues.VEHICLE_BRAKE = lt;
			}
		}
	}

	private processKeyboard(): void {
		// Teclado sobrescreve com valor 1 (binário)
		if (this.isKeyboardAction("VEHICLE_THROTTLE")) {
			this.analogValues.VEHICLE_THROTTLE = 1;
		}
		if (this.isKeyboardAction("VEHICLE_BRAKE")) {
			this.analogValues.VEHICLE_BRAKE = 1;
		}
		if (this.isKeyboardAction("VEHICLE_LEFT")) {
			this.analogValues.VEHICLE_LEFT = 1;
			this.analogValues.VEHICLE_RIGHT = 0;
		}
		if (this.isKeyboardAction("VEHICLE_RIGHT")) {
			this.analogValues.VEHICLE_RIGHT = 1;
			this.analogValues.VEHICLE_LEFT = 0;
		}
	}

	private isKeyboardAction(action: string): boolean {
		const keys = this.keyBindings[action];
		return keys ? keys.some(k => this.keys[k]) : false;
	}

	private applyDeadzone(value: number): number {
		if (Math.abs(value) < this.gamepadDeadzone) return 0;
		const sign = value > 0 ? 1 : -1;
		return sign * (Math.abs(value) - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
	}

	// === GETTERS PARA O PLAYER ===

	/** Valor de aceleração (0 a 1) */
	getThrottle(): number {
		return this.analogValues.VEHICLE_THROTTLE;
	}

	/** Valor de freio (0 a 1) */
	getBrake(): number {
		return this.analogValues.VEHICLE_BRAKE;
	}

	/** Valor de direção (-1 = esquerda, 0 = centro, +1 = direita) */
	getSteer(): number {
		return this.analogValues.VEHICLE_RIGHT - this.analogValues.VEHICLE_LEFT;
	}

	/** Verifica se uma ação está ativa (botão/tecla pressionado) */
	isActionActive(action: string): boolean {
		// Teclado
		const keys = this.keyBindings[action];
		if (keys && keys.some(k => this.keys[k])) return true;

		// Gamepad: estado lido em update() neste quadro
		const btnIndex = InputManager.GAMEPAD_BUTTON_BY_ACTION.get(action);
		return btnIndex !== undefined && this.gamepadPrevButtons[btnIndex] === true;
	}

	/** Verifica se há gamepad conectado */
	isGamepadConnected(): boolean {
		return this.getGamepad() !== null;
	}

	// === MÉTODOS DE TECLADO ===

	generateKeyMap(): void {
		this.keyMap = {};
		for (const [action, keys] of Object.entries(this.keyBindings)) {
			for (const key of keys) {
				this.keyMap[key.toLowerCase()] = action;
			}
		}
	}

	handleKeyDown(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		if (this.keys[key]) return;
		this.keys[key] = true;

		const action = this.keyMap[key];
		if (action && this.actions[action]) {
			this.actions[action]();
		}
	}

	handleKeyUp(e: KeyboardEvent): void {
		this.keys[e.key.toLowerCase()] = false;
	}

	isKeyPressed(key: string): boolean {
		return this.keys[key] === true;
	}

	// === MÉTODOS DE MOUSE ===

	handleMouseDown(e: MouseEvent): void {
		if (e.button === 0) this.mouse.isLeftDown = true;
		if (e.button === 2) this.mouse.isRightDown = true;
		this.mouse.position.x = e.clientX;
		this.mouse.position.y = e.clientY;
	}

	handleMouseUp(e: MouseEvent): void {
		if (e.button === 0) this.mouse.isLeftDown = false;
		if (e.button === 2) this.mouse.isRightDown = false;
		this.mouse.position.x = e.clientX;
		this.mouse.position.y = e.clientY;
	}

	handleMouseMove(e: MouseEvent): void {
		this.mouse.position.x = e.clientX;
		this.mouse.position.y = e.clientY;
		this.mouse.delta.x += e.movementX;
		this.mouse.delta.y += e.movementY;
		if (this.isPointerLocked()) {
			this.mouse.lastInputTime = Date.now();
		}
	}

	isPointerLocked(): boolean {
		return this.mouse.isLocked;
	}

	getAndResetMouseDelta(): { x: number; y: number } {
		const delta = { ...this.mouse.delta };
		this.mouse.delta.x = 0;
		this.mouse.delta.y = 0;
		return delta;
	}

	getTimeSinceLastInput(): number {
		return (Date.now() - this.mouse.lastInputTime) / 1000;
	}

	isLeftMouseDown(): boolean {
		return this.mouse.isLeftDown;
	}

	isRightMouseDown(): boolean {
		return this.mouse.isRightDown;
	}
}
