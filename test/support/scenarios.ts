import { DriveInput, idleInput, SimHandle, VehicleSnapshot } from "./sim";

/**
 * Cenários de referência da simulação (ROADMAP P0-4).
 *
 * Medem o comportamento atual para detectar regressões; os de plausibilidade
 * (0–100, frenagem de 100) alimentam limites físicos em vehicle-plausibility.test.ts.
 * Unidades SI (ADR-0002): metros, segundos, radianos; "hud" em km/h (Player.getCurrentSpeed).
 */

/** Tempo para o veículo assentar depois de nascer no ar */
export const SETTLE_TIME = 2;

export class ScenarioRunner {
	public time = 0;
	public nonFinite = false;

	constructor(
		private readonly sim: SimHandle,
		private readonly frameDt: number
	) {}

	setInput(input: Partial<DriveInput>): void {
		Object.assign(this.sim.input, idleInput(), input);
	}

	/** Avança `seconds`, chamando `onFrame` após cada quadro; para se `onFrame` retornar true */
	run(seconds: number, onFrame?: (s: VehicleSnapshot) => boolean | void): VehicleSnapshot {
		const frames = Math.round(seconds / this.frameDt);
		let snapshot = this.sim.snapshot();
		for (let i = 0; i < frames; i++) {
			this.sim.frame(this.frameDt);
			this.time += this.frameDt;
			snapshot = this.sim.snapshot();
			if (!isFiniteSnapshot(snapshot)) {
				this.nonFinite = true;
				return snapshot;
			}
			if (onFrame && onFrame(snapshot)) break;
		}
		return snapshot;
	}
}

export function isFiniteSnapshot(s: VehicleSnapshot): boolean {
	const values = [
		s.position.x, s.position.y, s.position.z,
		s.velocity.x, s.velocity.y, s.velocity.z,
		s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w,
		s.hudSpeed,
	];
	return values.every(Number.isFinite);
}

function horizontalDistance(a: VehicleSnapshot["position"], b: VehicleSnapshot["position"]): number {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Direção horizontal do eixo +X local do chassi (radianos, em torno de +Y) */
export function heading(q: VehicleSnapshot["quaternion"]): number {
	// +X local rotacionado pelo quaternion
	const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
	const fz = 2 * (q.x * q.z - q.w * q.y);
	return Math.atan2(-fz, fx);
}

/** Ângulo entre o +Y local do chassi e o +Y do mundo (radianos) */
export function tilt(q: VehicleSnapshot["quaternion"]): number {
	const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
	return Math.acos(Math.min(1, Math.max(-1, upY)));
}

function unwrap(delta: number): number {
	while (delta > Math.PI) delta -= 2 * Math.PI;
	while (delta < -Math.PI) delta += 2 * Math.PI;
	return delta;
}

export interface RestResult {
	/** Altura do chassi após 10 s */
	finalHeight: number;
	/** Deslocamento horizontal entre SETTLE_TIME e 10 s */
	drift: number;
	/** Maior velocidade (por deslocamento entre quadros) no último segundo */
	residualSpeed: number;
	/** Inclinação final do chassi */
	finalTilt: number;
	nonFinite: boolean;
}

export function restScenario(sim: SimHandle, frameDt: number): RestResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	const settled = runner.run(SETTLE_TIME);
	// por deslocamento: a Rapier reporta linvel ~g·dt com o chassi parado
	let residualSpeed = 0;
	let previous = runner.run(10 - SETTLE_TIME - 1);
	const final = runner.run(1, (s) => {
		const dp = Math.hypot(s.position.x - previous.position.x, s.position.y - previous.position.y, s.position.z - previous.position.z);
		residualSpeed = Math.max(residualSpeed, dp / frameDt);
		previous = s;
	});
	return {
		finalHeight: final.position.y,
		drift: horizontalDistance(settled.position, final.position),
		residualSpeed,
		finalTilt: tilt(final.quaternion),
		nonFinite: runner.nonFinite,
	};
}

export interface AccelerationResult {
	/** Velocidade do HUD a cada segundo de aceleração (1..5 s) */
	hudSpeedAt: number[];
	/** Distância percorrida em 5 s */
	distance: number;
	/** Desvio lateral do eixo inicial após 5 s (deveria ser ~0 em reta) */
	lateralDeviation: number;
	nonFinite: boolean;
}

export function accelerationScenario(sim: SimHandle, frameDt: number): AccelerationResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	const start = runner.run(SETTLE_TIME);
	const startHeading = heading(start.quaternion);
	runner.setInput({ throttle: true });
	const hudSpeedAt: number[] = [];
	let last = start;
	for (let second = 1; second <= 5; second++) {
		last = runner.run(1);
		hudSpeedAt.push(last.hudSpeed);
	}
	// desvio perpendicular à direção inicial
	const dx = last.position.x - start.position.x;
	const dz = last.position.z - start.position.z;
	const lateralDeviation = Math.abs(-Math.sin(startHeading) * dx - Math.cos(startHeading) * dz);
	return {
		hudSpeedAt,
		distance: horizontalDistance(start.position, last.position),
		lateralDeviation,
		nonFinite: runner.nonFinite,
	};
}

export interface BrakingResult {
	/** Velocidade do HUD no início da frenagem */
	initialHudSpeed: number;
	/** Tempo até a velocidade do HUD chegar a 0 (Infinity se não parar em 10 s) */
	timeToStop: number;
	/** Distância percorrida até parar */
	stoppingDistance: number;
	nonFinite: boolean;
}

/** Acelera por 5 s e freia (S) até a velocidade do HUD cruzar zero */
export function brakingScenario(sim: SimHandle, frameDt: number): BrakingResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	runner.run(SETTLE_TIME);
	runner.setInput({ throttle: true });
	const braking = runner.run(5);
	runner.setInput({ brake: true });
	const brakeStart = runner.time;
	let stopped = false;
	const end = runner.run(10, (s) => {
		stopped = s.hudSpeed <= 0;
		return stopped;
	});
	return {
		initialHudSpeed: braking.hudSpeed,
		timeToStop: stopped ? runner.time - brakeStart : Infinity,
		stoppingDistance: horizontalDistance(braking.position, end.position),
		nonFinite: runner.nonFinite,
	};
}

export interface TurnResult {
	/** Velocidade horizontal média nos últimos 2 s (m/s) */
	speed: number;
	/** Taxa de guinada média nos últimos 2 s (rad/s, positivo = esquerda) */
	yawRate: number;
	/** Raio aproximado da curva (m, speed / yawRate) */
	radius: number;
	/** Maior inclinação do chassi durante a curva */
	maxTilt: number;
	nonFinite: boolean;
}

/** Acelerador + esquerda mantidos por 6 s; mede os últimos 2 s */
export function turnScenario(sim: SimHandle, frameDt: number): TurnResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	runner.run(SETTLE_TIME);
	runner.setInput({ throttle: true, left: true });
	let maxTilt = 0;
	const trackTilt = (s: VehicleSnapshot) => {
		maxTilt = Math.max(maxTilt, tilt(s.quaternion));
	};
	let previous = runner.run(4, trackTilt);
	let yaw = 0;
	let path = 0;
	runner.run(2, (s) => {
		trackTilt(s);
		yaw += unwrap(heading(s.quaternion) - heading(previous.quaternion));
		path += horizontalDistance(previous.position, s.position);
		previous = s;
	});
	const speed = path / 2;
	const yawRate = yaw / 2;
	return {
		speed,
		yawRate,
		radius: Math.abs(yawRate) > 1e-6 ? speed / Math.abs(yawRate) : Infinity,
		maxTilt,
		nonFinite: runner.nonFinite,
	};
}

export interface ZeroToHundredResult {
	/** Tempo de 0 a 100 km/h com acelerador pleno (s; Infinity se não chegar em 15 s) */
	time: number;
	/** Distância percorrida até 100 km/h (m) */
	distance: number;
	nonFinite: boolean;
}

export const HUNDRED_KMH = 100;

/** Acelerador pleno a partir do repouso até o HUD marcar 100 km/h */
export function zeroToHundredScenario(sim: SimHandle, frameDt: number): ZeroToHundredResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	const start = runner.run(SETTLE_TIME);
	runner.setInput({ throttle: true });
	const t0 = runner.time;
	let reached = false;
	const end = runner.run(15, (s) => (reached = s.hudSpeed >= HUNDRED_KMH));
	return {
		time: reached ? runner.time - t0 : Infinity,
		distance: horizontalDistance(start.position, end.position),
		nonFinite: runner.nonFinite,
	};
}

export interface BrakingFromHundredResult {
	/** Velocidade do HUD ao começar a frear (km/h, >= 100) */
	initialHudSpeed: number;
	/** Tempo até o HUD chegar a 0 (s; Infinity se não parar em 10 s) */
	timeToStop: number;
	/** Distância de frenagem (m) */
	stoppingDistance: number;
	/** Desaceleração média: velocidade inicial / tempo (m/s²) */
	meanDeceleration: number;
	nonFinite: boolean;
}

/** Acelera até 100 km/h e freia (S) até parar */
export function brakingFromHundredScenario(sim: SimHandle, frameDt: number): BrakingFromHundredResult {
	const runner = new ScenarioRunner(sim, frameDt);
	runner.setInput({});
	runner.run(SETTLE_TIME);
	runner.setInput({ throttle: true });
	const braking = runner.run(15, (s) => s.hudSpeed >= HUNDRED_KMH);
	runner.setInput({ brake: true });
	const brakeStart = runner.time;
	let stopped = false;
	const end = runner.run(10, (s) => (stopped = s.hudSpeed <= 0));
	const timeToStop = stopped ? runner.time - brakeStart : Infinity;
	return {
		initialHudSpeed: braking.hudSpeed,
		timeToStop,
		stoppingDistance: horizontalDistance(braking.position, end.position),
		meanDeceleration: braking.hudSpeed / 3.6 / timeToStop,
		nonFinite: runner.nonFinite,
	};
}
