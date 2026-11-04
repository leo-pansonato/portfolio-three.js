import GameComponent from "../components/GameComponent";
import Player from "../components/Player";
import { VehicleDefinition } from "../data/vehicles";
import { Replay } from "../replay/Replay";
import { metersPerSecondToKmh } from "../ui/format";
import { createHudVehicleSpec } from "../ui/gauge";
import { MountedHud, mountHud } from "../ui/mountHud";
import { VehicleTelemetry } from "../vehicle/VehicleTelemetry";
import { REVERSE_GEAR } from "../vehicle/VehicleState";
import { devMode } from "./DevModeManager";

const WHEEL_LABELS = ["DE", "DD", "TE", "TD"];
const WHEEL_COLUMNS = [
	"contact",
	"compression",
	"suspension",
	"longitudinal",
	"lateral",
	"slipRatio",
	"slipAngle",
] as const;
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
	private engineCounter: HTMLElement | null;
	private wheelCells: Record<WheelColumn, HTMLElement>[] = [];
	private hudTimer = UIManager.DEV_HUD_INTERVAL;
	private recordButton: HTMLButtonElement | null;
	private playButton: HTMLButtonElement | null;
	private replayStatus: HTMLElement | null;
	private lastReplay: Replay | null = null;
	private raceHud: MountedHud | null = null;
	private hudVehicle: Readonly<VehicleDefinition> | null = null;

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
		this.engineCounter = document.getElementById("engine");
		this.createWheelTable(document.getElementById("telemetry-wheels"));
		this.recordButton = document.getElementById("replay-record") as HTMLButtonElement | null;
		this.playButton = document.getElementById("replay-play") as HTMLButtonElement | null;
		this.replayStatus = document.getElementById("replay-status");

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

	/** Liga os botões de gravar/reproduzir do HUD de dev ao veículo do jogador */
	bindReplayControls(player: Player): void {
		this.bindButton(this.recordButton, () => {
			if (player.isRecording) {
				this.lastReplay = player.stopRecording();
			} else {
				player.startRecording();
			}
			this.updateReplayStatus(player);
		});
		this.bindButton(this.playButton, () => {
			if (!this.lastReplay) return;
			player.playReplay(this.lastReplay);
			this.updateReplayStatus(player);
		});
	}

	private bindButton(button: HTMLButtonElement | null, handler: () => void): void {
		if (!button) return;
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			button.blur();
			handler();
		});
	}

	private updateReplayStatus(player: Player): void {
		if (this.recordButton) this.recordButton.textContent = player.isRecording ? "parar" : "gravar";
		if (this.playButton) this.playButton.disabled = !this.lastReplay || player.isRecording;
		if (!this.replayStatus) return;
		if (player.isRecording) this.replayStatus.textContent = `gravando ${player.recordedSteps} passos`;
		else if (player.isReplaying) this.replayStatus.textContent = "reproduzindo";
		else if (this.lastReplay) this.replayStatus.textContent = `${this.lastReplay.stepCount} passos`;
		else this.replayStatus.textContent = "";
	}

	onChangeDevMode(enabled: boolean): void {
		if (this.devOverlay) {
			this.devOverlay.style.display = enabled ? "flex" : "none";
		}
		this.hudTimer = UIManager.DEV_HUD_INTERVAL;
	}

	/** Monta o HUD de corrida (React) no elemento `#hud` */
	mountRaceHud(container = document.getElementById("hud")): void {
		if (!container || this.raceHud) return;
		this.raceHud = mountHud(container);
	}

	disposeRaceHud(): void {
		this.raceHud?.dispose();
		this.raceHud = null;
		this.hudVehicle = null;
	}

	/**
	 * Atualiza o HUD de corrida (por quadro) e as informações do player no HUD de dev (~10 Hz)
	 */
	updatePlayerInfo(deltaTime: number, player: Player): void {
		this.updateRaceHud(deltaTime, player);
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
		this.updateReplayStatus(player);
	}

	/** Copia marcha, rotação e velocidade da telemetria para o snapshot do HUD */
	private updateRaceHud(deltaTime: number, player: Player): void {
		const hud = this.raceHud;
		if (!hud) return;
		const definition = player.getDefinition();
		if (definition !== this.hudVehicle) {
			this.hudVehicle = definition;
			hud.store.setVehicle(createHudVehicleSpec(definition.powertrain));
		}
		const telemetry = player.getTelemetry();
		const frame = hud.store.frame;
		frame.speedKmh = Math.abs(metersPerSecondToKmh(telemetry.forwardSpeed));
		frame.engineRpm = telemetry.engineRpm;
		frame.gear = telemetry.gear;
		hud.store.publish(deltaTime);
	}

	private updateTelemetry(telemetry: Readonly<VehicleTelemetry>): void {
		if (this.accelerationCounter)
			this.accelerationCounter.textContent = `long ${telemetry.longitudinalAccelerationG.toFixed(2)} g  lat ${telemetry.lateralAccelerationG.toFixed(2)} g`;
		if (this.engineCounter) {
			const gear = telemetry.gear === REVERSE_GEAR ? "R" : String(telemetry.gear);
			this.engineCounter.textContent = `${gear}  ${telemetry.engineRpm.toFixed(0)} rpm`;
		}

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
			cells.slipRatio.textContent = (wheel.slipRatio * 100).toFixed(1);
			cells.slipAngle.textContent = ((wheel.slipAngle * 180) / Math.PI).toFixed(1);
		}
	}
}
