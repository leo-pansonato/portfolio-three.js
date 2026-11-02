import { QuatLike, Vec3Like } from "../physics/PhysicsWorld";

/**
 * Estado do veículo no início da gravação, num limite de passo de física.
 * Unidades SI e eixos do ADR-0002.
 */
export interface ReplayInitialState {
	vehicleId: string;
	/** Posição do chassi no mundo (m) */
	position: Vec3Like;
	rotation: QuatLike;
	/** Velocidade linear do chassi no mundo (m/s) */
	linearVelocity: Vec3Like;
	/** Velocidade angular do chassi no mundo (rad/s) */
	angularVelocity: Vec3Like;
	/** Esterço das rodas dianteiras (rad; positivo à esquerda) */
	steeringAngle: number;
}

/**
 * Replay: estado inicial + um InputFrame por passo de física, em arrays paralelos de `stepCount` itens.
 * Reproduz a trajetória só com o mesmo passo fixo e o mesmo mundo estático.
 */
export interface Replay {
	/** Passo fixo da gravação (s) */
	fixedTimeStep: number;
	initial: ReplayInitialState;
	stepCount: number;
	/** 0–1 */
	throttle: Float64Array;
	/** 0–1 */
	brake: Float64Array;
	/** −1…+1, positivo à direita */
	steer: Float64Array;
	/** Bits REPLAY_HANDBRAKE e REPLAY_BOOST */
	buttons: Uint8Array;
}

export const REPLAY_HANDBRAKE = 1;
export const REPLAY_BOOST = 2;
