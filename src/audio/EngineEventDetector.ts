/** Eventos do motor detectados pela telemetria (a partida é disparada por quem toca o banco) */
export type EngineEventName = "upshift" | "downshift" | "lift" | "pops";

/** Carga acima da qual o acelerador conta como pressionado e abaixo da qual como solto (0–1) */
const PRESSED_LOAD = 0.6;
const RELEASED_LOAD = 0.05;
/** Tempo máximo entre acelerador pressionado e solto para contar como tirar o pé (s) */
const LIFT_WINDOW = 0.25;
/** Rotação mínima para som de tirar o pé e de estalos (rpm) */
const LIFT_MIN_RPM = 2000;
/** Abaixo desta rotação, tirar o pé só dá estalos (o som de corte gravado é de rotação alta) (rpm) */
const LIFT_SOUND_MIN_RPM = 3500;
/** Depois de uma troca, o corte de acelerador da troca não conta como tirar o pé (s) */
const SHIFT_HOLD = 0.5;
/** Intervalo mínimo entre eventos (s) */
const MIN_INTERVAL = 0.3;
/** Carga máxima para som de redução: reduzir acelerando (kickdown) não tem blip (0–1) */
const DOWNSHIFT_MAX_LOAD = 0.3;
/** Chance de estalos ao tirar o pé */
const POPS_CHANCE = 0.5;

/**
 * Eventos do motor pela telemetria do quadro: troca para cima/baixo pela marcha (só à frente; redução só sem
 * acelerador), tirar o pé quando a carga cai de alta a zero em pouco tempo, fora de troca, com estalos sorteados.
 * Sem alocação.
 */
export default class EngineEventDetector {
	private time = 0;
	private gear = 0;
	private lastShift = -Infinity;
	private lastPressed = -Infinity;
	private lastEvent = -Infinity;
	private released = true;

	constructor(private readonly random: () => number = Math.random) {}

	/** Esquece o estado (troca de veículo, partida) */
	reset(gear: number): void {
		this.gear = gear;
		this.lastShift = -Infinity;
		this.lastPressed = -Infinity;
		this.released = true;
	}

	/**
	 * @param deltaTime tempo do quadro (s)
	 * @param gear marcha (1…n à frente, 0 ponto morto, −1 ré)
	 * @param rpm rotação do motor (rpm)
	 * @param load carga do motor (0–1)
	 * @returns evento do quadro, ou null
	 */
	update(deltaTime: number, gear: number, rpm: number, load: number): EngineEventName | null {
		this.time += deltaTime;
		const previousGear = this.gear;
		this.gear = gear;
		let event: EngineEventName | null = null;

		if (gear !== previousGear) {
			this.lastShift = this.time;
			if (previousGear >= 1 && gear > previousGear) event = "upshift";
			else if (gear >= 1 && gear < previousGear && load <= DOWNSHIFT_MAX_LOAD) event = "downshift";
		} else if (load >= PRESSED_LOAD) {
			this.lastPressed = this.time;
			this.released = false;
		} else if (load <= RELEASED_LOAD && !this.released) {
			this.released = true;
			const quickLift = this.time - this.lastPressed <= LIFT_WINDOW;
			const shifting = this.time - this.lastShift < SHIFT_HOLD;
			if (quickLift && !shifting && rpm >= LIFT_MIN_RPM) {
				const pops = rpm < LIFT_SOUND_MIN_RPM || this.random() < POPS_CHANCE;
				event = pops ? "pops" : "lift";
			}
		}

		if (!event || this.time - this.lastEvent < MIN_INTERVAL) return null;
		this.lastEvent = this.time;
		return event;
	}
}
