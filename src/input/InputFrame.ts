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

/** Olhar livre da câmera (mouse e analógico direito), atualizado uma vez por quadro pelo InputManager */
export interface LookInput {
	/** Movimento do mouse desde o quadro anterior (px) */
	deltaX: number;
	deltaY: number;
	pointerLocked: boolean;
	/** Taxa do analógico, positiva olhando para a direita (rad/s) */
	yawRate: number;
	/** Taxa do analógico, positiva olhando para cima (rad/s) */
	pitchRate: number;
	/** Passos de zoom desde o quadro anterior (roda do mouse; positivo afasta, um entalhe ≈ 1) */
	zoomSteps: number;
	/** Tempo desde o último movimento do mouse com o ponteiro travado ou do analógico fora da zona morta (s) */
	secondsSinceMove: number;
}

export function createInputFrame(): InputFrame {
	return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
}

export function createLookInput(): LookInput {
	return { deltaX: 0, deltaY: 0, pointerLocked: false, yawRate: 0, pitchRate: 0, zoomSteps: 0, secondsSinceMove: 0 };
}
