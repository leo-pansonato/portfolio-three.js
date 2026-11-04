/**
 * Mola criticamente amortecida com solução exata por passo: o resultado não depende do FPS
 * enquanto o alvo for constante dentro do intervalo.
 */
export default class CriticalSpring {
	value: number;
	/** Derivada de `value` (unidades/s) */
	velocity = 0;

	/** @param omega frequência natural (rad/s) */
	constructor(
		public omega: number,
		value = 0,
	) {
		this.value = value;
	}

	reset(value: number): void {
		this.value = value;
		this.velocity = 0;
	}

	step(target: number, dt: number): number {
		if (!(dt > 0)) return this.value;
		const offset = this.value - target;
		const slope = this.velocity + this.omega * offset;
		const decay = Math.exp(-this.omega * dt);
		this.value = target + (offset + slope * dt) * decay;
		this.velocity = (slope - this.omega * (offset + slope * dt)) * decay;
		return this.value;
	}
}
