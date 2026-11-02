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

/** Passo do diferencial numérico das curvas (adimensional e rad) */
const SLIP_DELTA = 1e-4;

/**
 * Dinâmica de uma roda com o pneu (ADR-0003, etapa 3): integra a velocidade angular e devolve as forças no chassi.
 * Euler implícito linearizado no início do passo: a força do pneu é tomada no fim do passo, com a inclinação
 * da curva (só a parte crescente) e a reação do chassi pela massa do contato. Assim a roda e o contato não
 * oscilam nem com escorregamento rígido em baixa velocidade, sem subpassos. O freio é atrito de Coulomb:
 * trava a roda se o torque necessário couber no freio. Força final limitada à elipse de atrito.
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

		const f = tire.computeForces(ratio, angle, load, this.forces);
		const fx0 = f.longitudinal;
		const fy0 = f.lateral;
		let longitudinalSlope = 0;
		let lateralSlope = 0;
		if (load > 0) {
			const ahead = tire.computeForces(ratio + SLIP_DELTA, angle, load, this.forces).longitudinal;
			const behind = tire.computeForces(ratio - SLIP_DELTA, angle, load, this.forces).longitudinal;
			longitudinalSlope = Math.max(0, (ahead - behind) / (2 * SLIP_DELTA)) / denominator;
			const right = tire.computeForces(ratio, angle + SLIP_DELTA, load, this.forces).lateral;
			const left = tire.computeForces(ratio, angle - SLIP_DELTA, load, this.forces).lateral;
			const angleRate = denominator / (denominator * denominator + vy * vy);
			lateralSlope = Math.max(0, (left - right) / (2 * SLIP_DELTA)) * angleRate;
		}

		let fy = fy0 / (1 + lateralSlope * dt * inverseMass);

		const maxLongitudinal = tire.config.longitudinal.peakFriction * load;
		const coupling = 1 + longitudinalSlope * dt * ((r * r) / inertia + inverseMass);
		const torqueGain = (longitudinalSlope * dt * r) / inertia;

		let locked = false;
		let wheelTorque = input.driveTorque;
		let fx: number;
		if (input.brakeTorque > 0) {
			let lockedForce = clamp(
				(fx0 - longitudinalSlope * r * omega) / (1 + longitudinalSlope * dt * inverseMass),
				maxLongitudinal,
			);
			if (inverseMass > 0) lockedForce = clamp(lockedForce, Math.abs(vx) / (dt * inverseMass));
			const holdingTorque = input.driveTorque - r * lockedForce + (inertia * omega) / dt;
			if (Math.abs(holdingTorque) <= input.brakeTorque) {
				locked = true;
				fx = lockedForce;
			} else {
				wheelTorque -= Math.sign(holdingTorque) * input.brakeTorque;
				fx = clamp((fx0 + torqueGain * wheelTorque) / coupling, maxLongitudinal);
			}
		} else {
			fx = clamp((fx0 + torqueGain * wheelTorque) / coupling, maxLongitudinal);
		}

		if (load > 0) {
			const maxLateral = tire.config.lateral.peakFriction * load;
			const usage = (fx / maxLongitudinal) ** 2 + (fy / maxLateral) ** 2;
			if (usage > 1) {
				const scale = 1 / Math.sqrt(usage);
				fx *= scale;
				fy *= scale;
			}
		} else {
			fx = 0;
			fy = 0;
		}

		wheel.angularVelocity = locked ? 0 : omega + (dt * (wheelTorque - r * fx)) / inertia;
		wheel.rotation += wheel.angularVelocity * dt;
		wheel.longitudinalForce = fx;
		wheel.lateralForce = fy;
	}
}

function clamp(value: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, value));
}
