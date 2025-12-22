import GameComponent from "../components/GameComponent";

/**
 * Gerenciador de entrada do usuário
 */
export default class InputManager extends GameComponent {
	// Usamos 'any' aqui para evitar Ciclo de Dependência com a classe Game
	// O ideal seria criar uma interface IGame separada.
	private game: any;
	private keys: { [key: string]: boolean };
	private mouse: { x: number; y: number; isDown: boolean };
	private keyBindings: { [action: string]: string[] };
	private actions: { [action: string]: () => void };
	private keyMap: { [key: string]: string };

	constructor(game: any) {
		super();
		this.game = game;
		this.keys = {};
		this.mouse = {
			x: 0,
			y: 0,
			isDown: false,
		};

		this.keyBindings = {
			TOGGLE_DEV_MODE: ["f2"],
			CYCLE_CAMERA_MODE: ["c"],
			SELECT_VEHICLE_1: ["1"],
			SELECT_VEHICLE_2: ["2"],
		};

		this.actions = {
			TOGGLE_DEV_MODE: () => this.game.ui.toggleDevMode(),
			CYCLE_CAMERA_MODE: () => this.game.cameraController.cycleCameraMode(),
			SELECT_VEHICLE_1: () => this.game.player.changeVehicle("bmw_f82"),
			SELECT_VEHICLE_2: () => this.game.player.changeVehicle("mercedes_g63"),
		};

		this.keyMap = {};
		this.generateKeyMap();

		this.setupEventListeners();
	}

	generateKeyMap(): void {
		this.keyMap = {}; // Limpa o mapa atual
		Object.entries(this.keyBindings).forEach(([actionName, keys]) => {
			keys.forEach((key) => {
				this.keyMap[key.toLowerCase()] = actionName;
			});
		});
	}

	setupEventListeners(): void {
		document.addEventListener("keydown", (e) => this.handleKeyDown(e));
		document.addEventListener("keyup", (e) => this.handleKeyUp(e));
		document.addEventListener("mousedown", (e) => this.handleMouseDown(e));
		document.addEventListener("mouseup", (e) => this.handleMouseUp(e));
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

	handleMouseDown(e: MouseEvent): void {
		this.mouse.isDown = true;
		this.mouse.x = e.clientX;
		this.mouse.y = e.clientY;
	}

	handleMouseUp(e: MouseEvent): void {
		this.mouse.isDown = false;
	}

	isKeyPressed(key: string): boolean {
		return this.keys[key] === true;
	}

	isMouseDown(): boolean {
		return this.mouse.isDown;
	}

	getMousePosition(): { x: number; y: number } {
		return { x: this.mouse.x, y: this.mouse.y };
	}
}
