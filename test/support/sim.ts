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

export interface SimHandle {
	readonly input: DriveInput;
	/** Avança um quadro do jogo, na mesma ordem do Game.gameLoop */
	frame(deltaTime: number): void;
	snapshot(): VehicleSnapshot;
}

export function idleInput(): DriveInput {
	return { throttle: false, brake: false, left: false, right: false, handbrake: false, boost: false };
}

/**
 * Substitui o InputManager: responde às consultas do Player a partir de um estado roteirizado.
 * Implementa a API binária (master) e a analógica (refact/rapier3d).
 */
export class ScriptedInput {
	public state: DriveInput = idleInput();

	isActionActive(action: string): boolean {
		switch (action) {
			case "VEHICLE_THROTTLE":
				return this.state.throttle;
			case "VEHICLE_BRAKE":
				return this.state.brake;
			case "VEHICLE_LEFT":
				return this.state.left;
			case "VEHICLE_RIGHT":
				return this.state.right;
			case "VEHICLE_HANDBRAKE":
				return this.state.handbrake;
			case "VEHICLE_BOOST":
				return this.state.boost;
			default:
				return false;
		}
	}

	getThrottle(): number {
		return this.state.throttle ? 1 : 0;
	}

	getBrake(): number {
		return this.state.brake ? 1 : 0;
	}

	/** -1 = esquerda, +1 = direita */
	getSteer(): number {
		return (this.state.right ? 1 : 0) - (this.state.left ? 1 : 0);
	}

	update(): void {}
}
