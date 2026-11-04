/** Fração percorrida em `dt` (s) por uma aproximação exponencial de taxa `lambda` (1/s) */
export function dampFactor(lambda: number, dt: number): number {
	return 1 - Math.exp(-lambda * Math.max(dt, 0));
}

/** Suavização exponencial independente do FPS: n passos de dt/n equivalem a um passo de dt */
export function damp(current: number, target: number, lambda: number, dt: number): number {
	return current + (target - current) * dampFactor(lambda, dt);
}
