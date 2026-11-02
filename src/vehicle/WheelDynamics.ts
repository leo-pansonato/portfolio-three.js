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
	/** Massa do chassi que o contato acelera (kg; 0 = infinita, chão de referência) */
	contactMass: number;
}

/** Iterações máximas da busca da raiz e tolerância relativa à força máxima */
const MAX_ITERATIONS = 40;
const RELATIVE_TOLERANCE = 1e-7;

/**
 * Dinâmica de uma roda com o pneu (ADR-0003, etapa 3): integra a velocidade angular e devolve as forças no chassi.
 * Euler implícito: a força do pneu é a do escorregamento no fim do passo, com a roda acelerada pelos torques e o
 * contato pela massa do chassi que ele carrega. Cada direção é uma equação F = Fpneu(escorregamento(F)), monótona,
 * resolvida por falsa posição (Illinois) entre ±μ·Fz: sem oscilação nem subpassos, mesmo parado. Primeiro a lateral
 * (com o escorregamento longitudinal do início do passo), depois a longitudinal. O freio é atrito de Coulomb: trava a
 * roda se o torque que a segura couber nele, senão se opõe ao giro. Força final limitada à elipse de atrito.
 * Sem alocação por passo.
 */
export default class WheelDynamics {
	private readonly forces: TireForces = { longitudinal: 0, lateral: 0 };

	/**
	 * @param radius raio da roda (m)
	 */
	constructor(
		readonly tire: Tire,
		readonly radius: number,
	) {}

	/** Avança a roda um passo de dt (s) */
	step(wheel: WheelState, input: Readonly<WheelStepInput>, dt: number): void {
		const tire = this.tire;
		const r = this.radius;
		const inertia = input.inertia;
		const load = Math.max(0, input.normalLoad);
		const inverseMass = input.contactMass > 0 ? 1 / input.contactMass : 0;
		const vx = input.longitudinalSpeed;
		const vy = input.lateralSpeed;
		const lowSpeed = tire.config.lowSpeedThreshold;
		const denominator = Math.max(Math.abs(vx), lowSpeed);
		const omega = wheel.angularVelocity;

		const ratio = slipRatio(omega * r, vx, lowSpeed);
		const angle = slipAngle(vx, vy, lowSpeed);
		wheel.slipRatio = ratio;
		wheel.slipAngle = angle;

		let fy = 0;
		let fx = 0;
		let lateralAngle = angle;
		if (load > 0) {
			fy = this.solveLateral(ratio, vy, denominator, (dt * inverseMass) / denominator, load);
			lateralAngle = Math.atan((vy + fy * dt * inverseMass) / denominator);
		}

		const spinCompliance = (dt * ((r * r) / inertia + inverseMass)) / denominator;
		let locked = false;
		let wheelTorque = input.driveTorque;
		if (input.brakeTorque > 0) {
			const lockedForce = this.solveLongitudinal(
				-vx / denominator,
				(dt * inverseMass) / denominator,
				lateralAngle,
				load,
			);
			const holdingTorque = input.driveTorque - r * lockedForce + (inertia * omega) / dt;
			if (Math.abs(holdingTorque) <= input.brakeTorque) {
				locked = true;
				fx = lockedForce;
			} else {
				wheelTorque -= Math.sign(holdingTorque) * input.brakeTorque;
			}
		}
		if (!locked) {
			const freeRatio = ((omega + (dt * wheelTorque) / inertia) * r - vx) / denominator;
			fx = this.solveLongitudinal(freeRatio, spinCompliance, lateralAngle, load);
		}

		if (load > 0) {
			const maxLongitudinal = tire.config.longitudinal.peakFriction * load;
			const maxLateral = tire.config.lateral.peakFriction * load;
			const usage = (fx / maxLongitudinal) ** 2 + (fy / maxLateral) ** 2;
			if (usage > 1) {
				const scale = 1 / Math.sqrt(usage);
				fx *= scale;
				fy *= scale;
			}
		}

		wheel.angularVelocity = locked ? 0 : omega + (dt * (wheelTorque - r * fx)) / inertia;
		wheel.rotation += wheel.angularVelocity * dt;
		wheel.longitudinalForce = fx;
		wheel.lateralForce = fy;
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
