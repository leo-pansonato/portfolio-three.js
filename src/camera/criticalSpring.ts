/** Estado de uma mola escalar: valor e taxa de variação (unidade do valor por s) */
export interface SpringState {
	value: number;
	velocity: number;
}

/**
 * Avança uma mola com amortecimento crítico (ω = 1/τ) por dt (s), em forma fechada.
 * O alvo é tratado como linear no intervalo: `target` é o valor no fim do passo e `targetVelocity` sua taxa.
 * Exata para alvo constante ou em rampa, então o resultado não depende de como o tempo é fatiado (FPS).
 * `velocityFeedForward` (0–1) é a fração da taxa do alvo seguida sem atraso: 0 atrasa 2·τ·taxa em regime, 1 não atrasa.
 */
export function stepCriticalSpring(
	state: SpringState,
	target: number,
	targetVelocity: number,
	dt: number,
	timeConstant: number,
	velocityFeedForward = 0,
): void {
	if (timeConstant <= 0) {
		state.value = target;
		state.velocity = targetVelocity;
		return;
	}
	const omega = 1 / timeConstant;
	const lag = 2 * (1 - velocityFeedForward) * targetVelocity * timeConstant;
	const f = state.value - (target - targetVelocity * dt) + lag;
	const fRate = state.velocity - targetVelocity;
	const temp = (fRate + omega * f) * dt;
	const decay = Math.exp(-omega * dt);
	state.value = target + (f + temp) * decay - lag;
	state.velocity = targetVelocity + (fRate - omega * temp) * decay;
}

/** Ângulo equivalente em [−π, π) (rad) */
export function wrapAngle(angle: number): number {
	return angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
}
