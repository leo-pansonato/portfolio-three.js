import GameComponent from "../components/GameComponent";

export default class InputManager extends GameComponent {
	private game: any;
	private keys: { [key: string]: boolean };

	private mouse: {
		position: { x: number; y: number };
		delta: { x: number; y: number };
		isLeftDown: boolean;
		isRightDown: boolean;
		isLocked: boolean;
		lastInputTime: number;
	};

	private keyBindings: { [action: string]: string[] };
	private actions: { [action: string]: () => void };
	private keyMap: { [key: string]: string };

	constructor(game: any) {
		super();
		this.game = game;
		this.keys = {};

		this.mouse = {
			position: { x: 0, y: 0 },
			delta: { x: 0, y: 0 },
			isLeftDown: false,
			isRightDown: false,
			isLocked: false,
			lastInputTime: Date.now(),
		};

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
			TOGGLE_DEV_MODE: () => this.game.ui.toggleDevMode(),
			CYCLE_CAMERA_MODE: () => this.game.cameraController.cycleCameraMode(),
			SELECT_VEHICLE_1: () => this.game.player.changeVehicle("bmw_f82"),
			SELECT_VEHICLE_2: () => this.game.player.changeVehicle("mercedes_g63"),
			RESET_CAR: () => this.game.player.resetCar(),
		};

		this.keyMap = {};
		this.generateKeyMap();
		this.setupEventListeners();
	}

	setupEventListeners(): void {
		document.addEventListener("keydown", (e) => this.handleKeyDown(e));
		document.addEventListener("keyup", (e) => this.handleKeyUp(e));
		document.addEventListener("mousedown", (e) => this.handleMouseDown(e));
		document.addEventListener("mouseup", (e) => this.handleMouseUp(e));
		document.addEventListener("mousemove", (e) => this.handleMouseMove(e));

		// Bloqueia o menu de contexto ao clicar com o botão direito
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
	}

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

		if (!this.isPointerLocked()) {
			return;
		}

		if (Math.abs(e.movementX) > 1 || Math.abs(e.movementY) > 1) {
			this.mouse.lastInputTime = Date.now();
		}
	}

	isPointerLocked(): boolean {
		return this.mouse.isLocked;
	}

	getAndResetMouseDelta(): { x: number; y: number } {
		const delta = { x: this.mouse.delta.x, y: this.mouse.delta.y };
		this.mouse.delta.x = 0;
		this.mouse.delta.y = 0;
		return delta;
	}

	getTimeSinceLastInput(): number {
		return (Date.now() - this.mouse.lastInputTime) / 1000;
	}

	generateKeyMap(): void {
		this.keyMap = {};
		Object.entries(this.keyBindings).forEach(([actionName, keys]) => {
			keys.forEach((key) => {
				this.keyMap[key.toLowerCase()] = actionName;
			});
		});
	}

	handleKeyDown(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		if (this.keys[key]) return;
		this.keys[key] = true;

		const actionName = this.keyMap[key];
		if (actionName && this.actions[actionName]) {
			this.actions[actionName]();
		}
	}

	handleKeyUp(e: KeyboardEvent): void {
		this.keys[e.key.toLowerCase()] = false;
	}

	isActionActive(actionName: string): boolean {
		const boundKeys = this.keyBindings[actionName];
		if (!boundKeys) return false;

		// Verifica se ALGUMA das teclas configuradas para essa ação está pressionada
		return boundKeys.some((key) => this.isKeyPressed(key));
	}

	isKeyPressed(key: string): boolean {
		return this.keys[key] === true;
	}

	isLeftMouseDown(): boolean {
		return this.mouse.isLeftDown;
	}

	isRightMouseDown(): boolean {
		return this.mouse.isRightDown;
	}
}
