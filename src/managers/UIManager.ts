import GameComponent from "../components/GameComponent";
import Player from "../components/Player";
import { VehicleTelemetry } from "../vehicle/VehicleTelemetry";
import { devMode } from "./DevModeManager";

const WHEEL_LABELS = ["DE", "DD", "TE", "TD"];
const WHEEL_COLUMNS = ["contact", "compression", "suspension", "longitudinal", "lateral"] as const;
type WheelColumn = (typeof WHEEL_COLUMNS)[number];

/**
 * Gerenciador de interface do usuário
 */
export default class UIManager extends GameComponent {
	/** Intervalo entre atualizações do HUD de dev (s) */
	static readonly DEV_HUD_INTERVAL = 0.1;

	private devOverlay: HTMLElement | null;
	private speedCounter: HTMLElement | null;
	private positionCounter: HTMLElement | null;
	private rotationCounter: HTMLElement | null;
	private wheelAngleCounter: HTMLElement | null;
	private accelerationCounter: HTMLElement | null;
	private wheelCells: Record<WheelColumn, HTMLElement>[] = [];
	private hudTimer = UIManager.DEV_HUD_INTERVAL;

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
		this.accelerationCounter = document.getElementById("acceleration");
		this.createWheelTable(document.getElementById("telemetry-wheels"));

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

	private createWheelTable(body: HTMLElement | null): void {
		if (!body) return;
		for (const label of WHEEL_LABELS) {
			const row = document.createElement("tr");
			const name = document.createElement("th");
			name.textContent = label;
			row.appendChild(name);
			const cells = {} as Record<WheelColumn, HTMLElement>;
			for (const column of WHEEL_COLUMNS) {
				const cell = document.createElement("td");
				cells[column] = cell;
				row.appendChild(cell);
			}
			this.wheelCells.push(cells);
			body.appendChild(row);
		}
	}

	onChangeDevMode(enabled: boolean): void {
		if (this.devOverlay) {
			this.devOverlay.style.display = enabled ? "flex" : "none";
		}
		this.hudTimer = UIManager.DEV_HUD_INTERVAL;
	}

	/**
	 * Atualiza informações do player na UI (~10 Hz)
	 */
	updatePlayerInfo(deltaTime: number, player: Player): void {
		if (!devMode.isEnabled()) return;

		this.hudTimer += deltaTime;
		if (this.hudTimer < UIManager.DEV_HUD_INTERVAL) return;
		this.hudTimer = 0;

		const speed = player.getCurrentSpeed();
		const position = player.getPosition();
		const rotation = player.getRotation();
		const wheelAngle = player.getWheelAngle();

		if (this.speedCounter) this.speedCounter.textContent = `${speed.toFixed(1)} km/h`;

		if (this.positionCounter)
			this.positionCounter.textContent = `X: ${position.x.toFixed(2)} Y: ${position.y.toFixed(2)} Z: ${position.z.toFixed(2)}`;

		if (this.rotationCounter)
			this.rotationCounter.textContent = `X: ${rotation?.x.toFixed(2)} Y: ${rotation?.y.toFixed(2)} Z: ${rotation?.z.toFixed(2)}`;

		if (this.wheelAngleCounter) this.wheelAngleCounter.textContent = wheelAngle.toFixed(2) + "°";

		this.updateTelemetry(player.getTelemetry());
	}

	private updateTelemetry(telemetry: Readonly<VehicleTelemetry>): void {
		if (this.accelerationCounter)
			this.accelerationCounter.textContent =
				`long ${telemetry.longitudinalAccelerationG.toFixed(2)} g  lat ${telemetry.lateralAccelerationG.toFixed(2)} g`;

		const toKiloNewton = telemetry.timeStep > 0 ? 1 / (telemetry.timeStep * 1000) : 0;
		for (let i = 0; i < this.wheelCells.length; i++) {
			const wheel = telemetry.wheels[i];
			const cells = this.wheelCells[i];
			if (!wheel) {
				for (const column of WHEEL_COLUMNS) cells[column].textContent = "-";
				continue;
			}
			cells.contact.textContent = wheel.inContact ? "sim" : "não";
			cells.compression.textContent = (wheel.compression * 1000).toFixed(0);
			cells.suspension.textContent = (wheel.suspensionForce / 1000).toFixed(2);
			cells.longitudinal.textContent = (wheel.forwardImpulse * toKiloNewton).toFixed(2);
			cells.lateral.textContent = (wheel.sideImpulse * toKiloNewton).toFixed(2);
		}
	}
}
