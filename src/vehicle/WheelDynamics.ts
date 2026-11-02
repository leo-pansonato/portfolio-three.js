import Tire, { slipAngle, slipRatio, TireForces } from "./Tire";

/** Estado de runtime de uma roda; reescrito no lugar por WheelDynamics.step */
export interface WheelState {
	/** Velocidade angular (rad/s; positiva rolando para a frente) */
	angularVelocity: number;
	/** Giro acumulado (rad) */
	rotation: number;
	/** Escorregamento longitudinal no início do passo (adimensional) */
	slipRatio: number;
	/** Ângulo de deriva no início do passo (rad) */
	slipAngle: number;
	/** Força longitudinal do pneu no chassi durante o passo (N, eixos da roda) */
	longitudinalForce: number;
	/** Força lateral do pneu no chassi durante o passo (N, eixos da roda) */
	lateralForce: number;
}

export function createWheelState(): WheelState {
	return { angularVelocity: 0, rotation: 0, slipRatio: 0, slipAngle: 0, longitudinalForce: 0, lateralForce: 0 };
}

/** Entrada de um passo para uma roda */
export interface WheelStepInput {
	/** Velocidade do ponto de contato ao longo da frente da roda (m/s) */
	longitudinalSpeed: number;
	/** Velocidade do ponto de contato ao longo da direita da roda (m/s) */
	lateralSpeed: number;
	/** Carga normal (N; 0 sem contato) */
	normalLoad: number;
	/** Torque de tração na roda (N·m; positivo para a frente) */
	driveTorque: number;
	/** Torque máximo do freio (N·m, ≥ 0): se opõe ao giro e pode travar a roda, nunca a inverte */
	brakeTorque: number;
	/** Inércia da roda mais a da transmissão refletida nela (kg·m²) */
	inertia: number;
	/** Massa efetiva do chassi no contato ao longo da frente da roda (kg; 0 = infinita, chão de referência) */
	longitudinalContactMass: number;
	/** Massa efetiva do chassi no contato ao longo da direita da roda (kg; 0 = infinita) */
	lateralContactMass: number;
}

/**
 * Passo de uma roda preparado (WheelDynamics.prepare) e resolvido para um torque de tração (WheelDynamics.solve).
 * Reutilizado a cada passo, sem alocação.
 */
export interface WheelStep {
	/** Passo de física (s) */
	dt: number;
	/** Velocidade angular no início do passo (rad/s) */
	initialAngularVelocity: number;
	/** Velocidade do contato ao longo da frente da roda (m/s) */
	longitudinalSpeed: number;
	/** Carga normal (N, ≥ 0) */
	load: number;
	/** max(|vx|, vMín) (m/s) */
	denominator: number;
	/** 1 / massa efetiva do contato ao longo da frente (1/kg; 0 = infinita) */
	inverseMass: number;
	/** Inércia da roda (kg·m²) */
	inertia: number;
	/** Torque máximo do freio (N·m) */
	brakeTorque: number;
	/** Escorregamento longitudinal no início do passo (adimensional) */
	initialSlipRatio: number;
	/** Ângulo de deriva no início do passo (rad) */
	initialSlipAngle: number;
	/** Força lateral antes da elipse de atrito (N) */
	unscaledLateralForce: number;
	/** Deriva no fim do passo, com a força lateral (rad) */
	lateralAngle: number;
	/** Torque de tração da última solução (N·m) */
	driveTorque: number;
	/** Velocidade angular no fim do passo (rad/s) */
	angularVelocity: number;
	/** Força longitudinal do pneu no passo (N, eixos da roda) */
	longitudinalForce: number;
	/** Força lateral do pneu no passo (N, eixos da roda) */
	lateralForce: number;
	/** Roda travada pelo freio */
	locked: boolean;
	/** dω/dT: resposta da velocidade no fim do passo ao torque de tração (rad/s por N·m; 0 travada) */
	torqueResponse: number;
}

export function createWheelStep(): WheelStep {
	return {
		dt: 0,
		initialAngularVelocity: 0,
		longitudinalSpeed: 0,
		load: 0,
		denominator: 1,
		inverseMass: 0,
		inertia: 1,
		brakeTorque: 0,
		initialSlipRatio: 0,
		initialSlipAngle: 0,
		unscaledLateralForce: 0,
		lateralAngle: 0,
		driveTorque: 0,
		angularVelocity: 0,
		longitudinalForce: 0,
		lateralForce: 0,
		locked: false,
		torqueResponse: 0,
	};
}

/** Iterações máximas da busca da raiz e tolerância relativa à força máxima */
const MAX_ITERATIONS = 40;
const RELATIVE_TOLERANCE = 1e-7;
/** Passo do escorregamento na derivada numérica da força longitudinal (adimensional) */
const SLIP_DERIVATIVE_STEP = 1e-4;

/**
 * Dinâmica de uma roda com o pneu (ADR-0003, etapa 3): integra a velocidade angular e devolve as forças no chassi.
 * Euler implícito: a força do pneu é a do escorregamento no fim do passo, com a roda acelerada pelos torques e o
 * contato pela massa do chassi que ele carrega. Cada direção é uma equação F = Fpneu(escorregamento(F)), monótona,
 * resolvida por falsa posição (Illinois) entre ±μ·Fz: sem oscilação nem subpassos, mesmo parado. Primeiro a lateral
 * (com o escorregamento longitudinal do início do passo), depois a longitudinal. O freio é atrito de Coulomb: trava a
 * roda se o torque que a segura couber nele, senão se opõe ao giro. Força final limitada à elipse de atrito.
 * `prepare` faz a parte que não depende do torque de tração, `solve` pode ser chamado várias vezes (trem de força)
 * e `commit` grava a última solução. Sem alocação por passo.
 */
export default class WheelDynamics {
	private readonly forces: TireForces = { longitudinal: 0, lateral: 0 };
	private readonly scratch: WheelStep = createWheelStep();

	/**
	 * @param radius raio da roda (m)
	 */
	constructor(
		readonly tire: Tire,
		readonly radius: number,
	) {}

	/** Avança a roda um passo de dt (s) com o torque de tração da entrada */
	step(wheel: WheelState, input: Readonly<WheelStepInput>, dt: number): void {
		const step = this.scratch;
		this.prepare(wheel, input, dt, step);
		this.solve(step, input.driveTorque, false);
		this.commit(wheel, step);
	}

	/** Prepara o passo: escorregamentos do início e força lateral, que não dependem do torque de tração */
	prepare(wheel: Readonly<WheelState>, input: Readonly<WheelStepInput>, dt: number, step: WheelStep): void {
		const lowSpeed = this.tire.config.lowSpeedThreshold;
		const load = Math.max(0, input.normalLoad);
		const inverseLateralMass = input.lateralContactMass > 0 ? 1 / input.lateralContactMass : 0;
		const vx = input.longitudinalSpeed;
		const vy = input.lateralSpeed;
		const denominator = Math.max(Math.abs(vx), lowSpeed);
		const omega = wheel.angularVelocity;
		const ratio = slipRatio(omega * this.radius, vx, lowSpeed);
		const angle = slipAngle(vx, vy, lowSpeed);

		step.dt = dt;
		step.initialAngularVelocity = omega;
		step.longitudinalSpeed = vx;
		step.load = load;
		step.denominator = denominator;
		step.inverseMass = input.longitudinalContactMass > 0 ? 1 / input.longitudinalContactMass : 0;
		step.inertia = input.inertia;
		step.brakeTorque = input.brakeTorque;
		step.initialSlipRatio = ratio;
		step.initialSlipAngle = angle;
		step.unscaledLateralForce = 0;
		step.lateralAngle = angle;
		if (load > 0) {
			const fy = this.solveLateral(ratio, vy, denominator, (dt * inverseLateralMass) / denominator, load);
			step.unscaledLateralForce = fy;
			step.lateralAngle = Math.atan((vy + fy * dt * inverseLateralMass) / denominator);
		}
	}

	/**
	 * Resolve o passo preparado para o torque de tração dado (N·m), sem alterar o estado da roda
	 * @param withResponse calcula também dω/dT (torqueResponse; 0 se falso)
	 */
	solve(step: WheelStep, driveTorque: number, withResponse: boolean): void {
		const r = this.radius;
		const dt = step.dt;
		const inertia = step.inertia;
		const load = step.load;
		const vx = step.longitudinalSpeed;
		const denominator = step.denominator;
		const inverseMass = step.inverseMass;
		const omega = step.initialAngularVelocity;
		const lateralAngle = step.lateralAngle;
		let fy = step.unscaledLateralForce;

		const spinCompliance = (dt * ((r * r) / inertia + inverseMass)) / denominator;
		let fx = 0;
		let freeRatio = 0;
		let locked = false;
		let wheelTorque = driveTorque;
		if (step.brakeTorque > 0) {
			const lockedForce = this.solveLongitudinal(
				-vx / denominator,
				(dt * inverseMass) / denominator,
				lateralAngle,
				load,
			);
			const holdingTorque = driveTorque - r * lockedForce + (inertia * omega) / dt;
			if (Math.abs(holdingTorque) <= step.brakeTorque) {
				locked = true;
				fx = lockedForce;
			} else {
				wheelTorque -= Math.sign(holdingTorque) * step.brakeTorque;
			}
		}
		if (!locked) {
			freeRatio = ((omega + (dt * wheelTorque) / inertia) * r - vx) / denominator;
			fx = this.solveLongitudinal(freeRatio, spinCompliance, lateralAngle, load);
		}

		let response = 0;
		if (withResponse && !locked) {
			let forcePerTorque = 0;
			if (load > 0) {
				const slip = freeRatio - spinCompliance * fx;
				const above = this.tire.computeForces(slip + SLIP_DERIVATIVE_STEP, lateralAngle, load, this.forces);
				const forceAbove = above.longitudinal;
				const forceBelow = this.tire.computeForces(
					slip - SLIP_DERIVATIVE_STEP,
					lateralAngle,
					load,
					this.forces,
				).longitudinal;
				const slope = (forceAbove - forceBelow) / (2 * SLIP_DERIVATIVE_STEP);
				const ratioPerTorque = (dt * r) / (inertia * denominator);
				forcePerTorque = (slope * ratioPerTorque) / Math.max(1e-6, 1 + spinCompliance * slope);
			}
			response = Math.max(0, (dt / inertia) * (1 - r * forcePerTorque));
		}

		if (load > 0) {
			const maxLongitudinal = this.tire.config.longitudinal.peakFriction * load;
			const maxLateral = this.tire.config.lateral.peakFriction * load;
			const usage = (fx / maxLongitudinal) ** 2 + (fy / maxLateral) ** 2;
			if (usage > 1) {
				const scale = 1 / Math.sqrt(usage);
				fx *= scale;
				fy *= scale;
			}
		}

		step.driveTorque = driveTorque;
		step.locked = locked;
		step.angularVelocity = locked ? 0 : omega + (dt * (wheelTorque - r * fx)) / inertia;
		step.longitudinalForce = fx;
		step.lateralForce = fy;
		step.torqueResponse = response;
	}

	/** Grava no estado da roda a última solução do passo */
	commit(wheel: WheelState, step: Readonly<WheelStep>): void {
		wheel.slipRatio = step.initialSlipRatio;
		wheel.slipAngle = step.initialSlipAngle;
		wheel.angularVelocity = step.angularVelocity;
		wheel.rotation += step.angularVelocity * step.dt;
		wheel.longitudinalForce = step.longitudinalForce;
		wheel.lateralForce = step.lateralForce;
	}

	/**
	 * Força longitudinal F (N) com F = Fx(κ0 − c·F, α): o escorregamento no fim do passo cai com a própria força
	 * @param freeRatio escorregamento no fim do passo sem força do pneu (adimensional)
	 * @param compliance queda do escorregamento por newton (1/N)
	 */
	private solveLongitudinal(freeRatio: number, compliance: number, angle: number, load: number): number {
		const limit = this.tire.config.longitudinal.peakFriction * load;
		if (limit <= 0) return 0;
		let low = -limit;
		let high = limit;
		let lowValue =
			low - this.tire.computeForces(freeRatio - compliance * low, angle, load, this.forces).longitudinal;
		let highValue =
			high - this.tire.computeForces(freeRatio - compliance * high, angle, load, this.forces).longitudinal;
		if (lowValue >= 0) return low;
		if (highValue <= 0) return high;
		let side = 0;
		let x = 0;
		for (let i = 0; i < MAX_ITERATIONS; i++) {
			x = (low * highValue - high * lowValue) / (highValue - lowValue);
			const value =
				x - this.tire.computeForces(freeRatio - compliance * x, angle, load, this.forces).longitudinal;
			if (Math.abs(value) <= RELATIVE_TOLERANCE * limit) break;
			if (value < 0) {
				low = x;
				lowValue = value;
				if (side === -1) highValue /= 2;
				side = -1;
			} else {
				high = x;
				highValue = value;
				if (side === 1) lowValue /= 2;
				side = 1;
			}
		}
		return x;
	}

	/**
	 * Força lateral F (N) com F = Fy(κ, atan((vy + F·dt/m) / den)): a velocidade lateral no fim do passo muda com F
	 * @param compliance variação de vy/den por newton (1/N)
	 */
	private solveLateral(
		ratio: number,
		lateralSpeed: number,
		denominator: number,
		compliance: number,
		load: number,
	): number {
		const limit = this.tire.config.lateral.peakFriction * load;
		const base = lateralSpeed / denominator;
		let low = -limit;
		let high = limit;
		let lowValue =
			low - this.tire.computeForces(ratio, Math.atan(base + compliance * low), load, this.forces).lateral;
		let highValue =
			high - this.tire.computeForces(ratio, Math.atan(base + compliance * high), load, this.forces).lateral;
		if (lowValue >= 0) return low;
		if (highValue <= 0) return high;
		let side = 0;
		let x = 0;
		for (let i = 0; i < MAX_ITERATIONS; i++) {
			x = (low * highValue - high * lowValue) / (highValue - lowValue);
			const value =
				x - this.tire.computeForces(ratio, Math.atan(base + compliance * x), load, this.forces).lateral;
			if (Math.abs(value) <= RELATIVE_TOLERANCE * limit) break;
			if (value < 0) {
				low = x;
				lowValue = value;
				if (side === -1) highValue /= 2;
				side = -1;
			} else {
				high = x;
				highValue = value;
				if (side === 1) lowValue /= 2;
				side = 1;
			}
		}
		return x;
	}
}
