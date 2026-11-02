/**
 * Contrato `InputFrame` (ARCHITECTURE §5): comandos do motorista, normalizados e independentes de dispositivo.
 * Dono: InputManager, que o reescreve uma vez por quadro antes da física; os consumidores só leem.
 * Todos os passos de física de um quadro leem o mesmo valor.
 */
export interface InputFrame {
	/** Acelerador (0–1) */
	throttle: number;
	/** Freio / ré (0–1) */
	brake: number;
	/** Volante (−1 esquerda, +1 direita) */
	steer: number;
	handbrake: boolean;
	boost: boolean;
}

/** Olhar livre da câmera (mouse), atualizado uma vez por quadro pelo InputManager */
export interface LookInput {
	/** Movimento do mouse desde o quadro anterior (px) */
	deltaX: number;
	deltaY: number;
	pointerLocked: boolean;
	/** Tempo desde o último movimento com o ponteiro travado (s) */
	secondsSinceMove: number;
}

export function createInputFrame(): InputFrame {
	return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
}

export function createLookInput(): LookInput {
	return { deltaX: 0, deltaY: 0, pointerLocked: false, secondsSinceMove: 0 };
}
