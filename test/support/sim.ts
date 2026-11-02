import { InputFrame } from "../../src/input/InputFrame";

/**
 * Contrato entre os cenários de referência e uma implementação de física.
 * Os cenários só conhecem esta interface; cada motor tem seu adaptador
 * (ver cannonSim.ts).
 */

export interface DriveInput {
	throttle: boolean;
	brake: boolean;
	left: boolean;
	right: boolean;
	handbrake: boolean;
	boost: boolean;
}

export interface VehicleSnapshot {
	/** Posição do chassi (unidades do mundo) */
	position: { x: number; y: number; z: number };
	/** Velocidade linear do chassi (unidades/s) */
	velocity: { x: number; y: number; z: number };
	/** Rotação do chassi */
	quaternion: { x: number; y: number; z: number; w: number };
	/** Velocidade exibida no HUD (Player.getCurrentSpeed) */
	hudSpeed: number;
}

/** Valores analógicos que, quando definidos, substituem os digitais do roteiro */
export interface AnalogInput {
	/** Acelerador (0–1) */
	throttle?: number;
	/** Volante (−1 esquerda a 1 direita) */
	steer?: number;
}

export interface SimHandle {
	readonly input: DriveInput;
	readonly analog: AnalogInput;
	/** Avança um quadro do jogo, na mesma ordem do Game.gameLoop */
	frame(deltaTime: number): void;
	snapshot(): VehicleSnapshot;
}

export function idleInput(): DriveInput {
	return { throttle: false, brake: false, left: false, right: false, handbrake: false, boost: false };
}

/**
 * Substitui o InputManager: expõe o roteiro como InputFrame (lido pelo Player a cada passo).
 * Teclado digital: cada controle vale 0 ou 1, salvo acelerador e volante definidos em `analog`.
 */
export class ScriptedInput implements Readonly<InputFrame> {
	public state: DriveInput = idleInput();
	public analog: AnalogInput = {};

	get throttle(): number {
		return this.analog.throttle ?? (this.state.throttle ? 1 : 0);
	}

	get brake(): number {
		return this.state.brake ? 1 : 0;
	}

	get steer(): number {
		return this.analog.steer ?? (this.state.right ? 1 : 0) - (this.state.left ? 1 : 0);
	}

	get handbrake(): boolean {
		return this.state.handbrake;
	}

	get boost(): boolean {
		return this.state.boost;
	}
}
