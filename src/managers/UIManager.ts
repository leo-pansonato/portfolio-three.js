import GameComponent from "../components/GameComponent";
import Player from "../components/Player";
import { devMode } from "./DevModeManager";

/**
 * Gerenciador de interface do usuário
 */
export default class UIManager extends GameComponent {
	private devOverlay: HTMLElement | null;
	private speedCounter: HTMLElement | null;
	private positionCounter: HTMLElement | null;
	private rotationCounter: HTMLElement | null;
	private wheelAngleCounter: HTMLElement | null;

	public ui: {
		overlays: { dev: HTMLElement | null };
		controls: { keys: HTMLElement | null; mouse: HTMLElement | null; scroll: HTMLElement | null };
	};

	constructor() {
		super();
		this.devOverlay = document.getElementById("dev-overlay");
		this.speedCounter = document.getElementById("speed");
		this.positionCounter = document.getElementById("position");
		this.rotationCounter = document.getElementById("rotation");
		this.wheelAngleCounter = document.getElementById("wheel-angle");

		this.ui = {
			overlays: {
				dev: this.devOverlay,
			},
			controls: {
				keys: document.getElementById("ctrlKeys"),
				mouse: document.getElementById("ctrlMouse"),
				scroll: document.getElementById("ctrlScroll"),
			},
		};

		devMode.subscribe("ui-manager", (enabled) => this.onChangeDevMode(enabled));
	}


	onChangeDevMode(enabled: boolean): void {
		if (this.devOverlay) {
			this.devOverlay.style.display = enabled ? "flex" : "none";
		}
	}

	/**
	 * Atualiza informações do player na UI
	 */
	updatePlayerInfo(_deltaTime: number, player: Player): void {
		if (!devMode.isEnabled()) return;

		const speed = player.getCurrentSpeed();
		const position = player.getPosition();
		const rotation = player.getRotation();
		const wheelAngle = player.getWheelAngle();

		// Atualiza os contadores
		if (this.speedCounter) this.speedCounter.textContent = speed.toFixed(2);

		if (this.positionCounter)
			this.positionCounter.textContent = `X: ${position.x.toFixed(2)} Y: ${position.y.toFixed(2)} Z: ${position.z.toFixed(2)}`;

		if (this.rotationCounter)
			this.rotationCounter.textContent = `X: ${rotation?.x.toFixed(2)} Y: ${rotation?.y.toFixed(2)} Z: ${rotation?.z.toFixed(2)}`;

		if (this.wheelAngleCounter) this.wheelAngleCounter.textContent = wheelAngle.toFixed(2) + "°";
	}
}
