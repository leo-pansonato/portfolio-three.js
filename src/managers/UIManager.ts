import GameComponent from "../components/GameComponent";
import PhysicsManager from "./PhysicsManager";
import * as THREE from "three";

// Interface para representar o Player esperado por este manager
// (Já que não temos o arquivo Player.ts ainda)
interface IPlayer {
	getCurrentSpeed(): number;
	getPosition(): THREE.Vector3;
	getRotation(): THREE.Euler;
	getWheelAngle(): number;
}

/**
 * Gerenciador de interface do usuário
 */
export default class UIManager extends GameComponent {
	private devMode: boolean;
	private devOverlay: HTMLElement | null;
	private speedCounter: HTMLElement | null;
	private positionCounter: HTMLElement | null;
	private rotationCounter: HTMLElement | null;
	private wheelAngleCounter: HTMLElement | null;
	private physicsManager: PhysicsManager | null;

	public ui: {
		overlays: { dev: HTMLElement | null };
		controls: { keys: HTMLElement | null; mouse: HTMLElement | null; scroll: HTMLElement | null };
	};

	constructor() {
		super();
		this.devMode = true;
		this.devOverlay = document.getElementById("dev-overlay");
		this.speedCounter = document.getElementById("speed");
		this.positionCounter = document.getElementById("position");
		this.rotationCounter = document.getElementById("rotation");
		this.wheelAngleCounter = document.getElementById("wheel-angle");
		this.physicsManager = null;

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
	}

	setupDevMode(physicsManager: PhysicsManager): void {
		if (!physicsManager) return;

		this.physicsManager = physicsManager;
		this.changeDevMode(this.devMode);
	}

	changeDevMode(mode: boolean): void {
		if (!this.physicsManager) return;

		// Código comentado mantido do original
		// if (mode) {
		//    this.physicsManager.addDebugger();
		// } else {
		//    this.physicsManager.removeDebugger();
		// }

		if (this.devOverlay) {
			this.devOverlay.style.display = mode ? "flex" : "none";
		}

		this.devMode = mode;
	}

	toggleDevMode(): void {
		this.changeDevMode(!this.devMode);
	}

	updatePlayerInfo(deltaTime: number, player: IPlayer): void {
		if (!this.devMode || !this.physicsManager) return;

		const speed = player.getCurrentSpeed();
		const position = player.getPosition();
		const rotation = player.getRotation();
		const wheelAngle = player.getWheelAngle();

		// Atualizar o debugger física
		this.physicsManager.updateDebugger();

		// Atualiza os contadores
		if (this.speedCounter) this.speedCounter.textContent = speed.toFixed(2);

		if (this.positionCounter) {
			this.positionCounter.textContent = `X: ${position.x.toFixed(2)} Y: ${position.y.toFixed(2)} Z: ${position.z.toFixed(2)}`;
		}

		if (this.rotationCounter) {
			this.rotationCounter.textContent = `X: ${rotation.x.toFixed(2)} Y: ${rotation.y.toFixed(2)} Z: ${rotation.z.toFixed(2)}`;
		}

		if (this.wheelAngleCounter) {
			this.wheelAngleCounter.textContent = wheelAngle.toFixed(2) + "°";
		}
	}
}
