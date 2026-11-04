/** Marcha da telemetria (1…n, 0 ponto morto, −1 ré) como texto do HUD */
export function formatGear(gear: number): string {
	if (gear < 0) return "R";
	if (gear === 0) return "N";
	return String(gear);
}

export function metersPerSecondToKmh(speed: number): number {
	return speed * 3.6;
}

/**
 * Inteiro exibido com histerese: só muda quando `value` passa do meio inteiro mais `hysteresis`,
 * para o número não alternar entre dois valores vizinhos.
 */
export function stableInteger(value: number, previous: number, hysteresis: number): number {
	if (!Number.isFinite(value)) return previous;
	if (Math.abs(value - previous) < 0.5 + hysteresis) return previous;
	return Math.round(value);
}

/** Zeros à esquerda que completam `digits` algarismos (exibidos apagados, largura constante) */
export function leadingZeros(text: string, digits: number): string {
	return text.length >= digits ? "" : "0".repeat(digits - text.length);
}

/** Velocidade exibida (km/h, inteiro não negativo) */
export function formatSpeed(speedKmh: number): string {
	return String(Math.max(0, Math.round(Math.abs(speedKmh))));
}
