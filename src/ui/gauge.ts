/** Faixas de rotação do conta-giros de um veículo (rpm) */
export interface HudVehicleSpec {
	idleRpm: number;
	/** Início da faixa vermelha: rotação em que o câmbio sobe de marcha */
	redlineRpm: number;
	/** Corte de giro */
	revLimitRpm: number;
	/** A partir daqui o alerta de troca pisca */
	shiftAlertRpm: number;
	/** Fim da escala do mostrador */
	dialMaxRpm: number;
}

/** Arco do mostrador em graus, sentido horário a partir das 12 h */
export interface DialArc {
	startDeg: number;
	sweepDeg: number;
}

export const TACHOMETER_ARC: DialArc = { startDeg: -125, sweepDeg: 250 };

/** Antecedência do alerta de troca em relação à faixa vermelha (rpm) */
export const SHIFT_ALERT_LEAD_RPM = 250;

export interface DialTick {
	rpm: number;
	angleDeg: number;
	major: boolean;
	/** Rótulo em milhares de rpm; null nos traços menores */
	label: string | null;
	inRedline: boolean;
}

export function createHudVehicleSpec(powertrain: {
	idleRpm: number;
	upshiftRpm: number;
	revLimitRpm: number;
}): HudVehicleSpec {
	const redlineRpm = Math.min(powertrain.upshiftRpm, powertrain.revLimitRpm);
	return {
		idleRpm: powertrain.idleRpm,
		redlineRpm,
		revLimitRpm: powertrain.revLimitRpm,
		shiftAlertRpm: redlineRpm - SHIFT_ALERT_LEAD_RPM,
		dialMaxRpm: Math.ceil((powertrain.revLimitRpm + 250) / 1000) * 1000,
	};
}

export function rpmFraction(rpm: number, dialMaxRpm: number): number {
	if (!(dialMaxRpm > 0) || !Number.isFinite(rpm)) return 0;
	return Math.min(Math.max(rpm / dialMaxRpm, 0), 1);
}

export function fractionToAngleDeg(fraction: number, arc: DialArc = TACHOMETER_ARC): number {
	return arc.startDeg + arc.sweepDeg * fraction;
}

export function rpmToAngleDeg(rpm: number, dialMaxRpm: number, arc: DialArc = TACHOMETER_ARC): number {
	return fractionToAngleDeg(rpmFraction(rpm, dialMaxRpm), arc);
}

/** Ponto no círculo de raio `radius`; ângulo em graus, horário a partir das 12 h, y para baixo (SVG) */
export function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
	const rad = (angleDeg * Math.PI) / 180;
	return { x: round3(radius * Math.sin(rad)), y: round3(-radius * Math.cos(rad)) };
}

/** Caminho SVG de um arco centrado na origem, de `startDeg` a `endDeg` no sentido horário */
export function arcPath(radius: number, startDeg: number, endDeg: number): string {
	const start = polarPoint(radius, startDeg);
	const end = polarPoint(radius, endDeg);
	const largeArc = endDeg - startDeg > 180 ? 1 : 0;
	return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function buildTicks(spec: HudVehicleSpec, minorStepRpm = 500, majorStepRpm = 1000): DialTick[] {
	const ticks: DialTick[] = [];
	for (let rpm = 0; rpm <= spec.dialMaxRpm + 1e-6; rpm += minorStepRpm) {
		const major = rpm % majorStepRpm === 0;
		ticks.push({
			rpm,
			angleDeg: rpmToAngleDeg(rpm, spec.dialMaxRpm),
			major,
			label: major ? String(rpm / 1000) : null,
			inRedline: rpm >= spec.redlineRpm,
		});
	}
	return ticks;
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000 + 0;
}
