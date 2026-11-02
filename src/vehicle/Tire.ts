import { PacejkaCurve, VehicleTireConfig } from "../data/vehicles/types";

/** Forças do pneu no plano de contato (N), nos eixos da roda */
export interface TireForces {
	/** Ao longo da frente da roda (positiva empurra o chassi para a frente) */
	longitudinal: number;
	/** Ao longo da direita da roda (+Z quando reta) */
	lateral: number;
}

/** Curva de Pacejka normalizada (D = 1) no escorregamento x */
export function magicFormula(curve: Readonly<PacejkaCurve>, x: number): number {
	const bx = curve.stiffness * x;
	return Math.sin(curve.shape * Math.atan(bx - curve.curvature * (bx - Math.atan(bx))));
}

/**
 * Escorregamento do pico da curva (x > 0, unidade de x): onde C·atan(B·x − E·(B·x − atan(B·x))) = π/2.
 * Exige C > 1 (com C ≤ 1 a curva não tem pico) e E ≤ 1 (argumento crescente em x).
 */
export function peakSlip(curve: Readonly<PacejkaCurve>): number {
	if (!(curve.shape > 1)) throw new Error(`Curva de pneu sem pico: C = ${curve.shape} (precisa ser > 1)`);
	if (!(curve.curvature <= 1))
		throw new Error(`Curvatura de pneu inválida: E = ${curve.curvature} (precisa ser ≤ 1)`);
	const target = Math.tan(Math.PI / (2 * curve.shape));
	const argument = (x: number) => {
		const bx = curve.stiffness * x;
		return bx - curve.curvature * (bx - Math.atan(bx));
	};
	let low = 0;
	let high = 1 / curve.stiffness;
	while (argument(high) < target) high *= 2;
	for (let i = 0; i < 100; i++) {
		const middle = (low + high) / 2;
		if (argument(middle) < target) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}

/**
 * Escorregamento longitudinal (adimensional; positivo tracionando): (ω·r − vx) / max(|vx|, vMin)
 * @param wheelSurfaceSpeed velocidade da banda de rodagem ω·r (m/s)
 * @param longitudinalSpeed velocidade do contato ao longo da frente da roda (m/s)
 * @param lowSpeedThreshold vMin (m/s)
 */
export function slipRatio(wheelSurfaceSpeed: number, longitudinalSpeed: number, lowSpeedThreshold: number): number {
	return (wheelSurfaceSpeed - longitudinalSpeed) / Math.max(Math.abs(longitudinalSpeed), lowSpeedThreshold);
}

/**
 * Ângulo de deriva (rad; positivo com o contato indo para a direita da roda): atan(vy / max(|vx|, vMin))
 * @param longitudinalSpeed velocidade do contato ao longo da frente da roda (m/s)
 * @param lateralSpeed velocidade do contato ao longo da direita da roda (m/s)
 * @param lowSpeedThreshold vMin (m/s)
 */
export function slipAngle(longitudinalSpeed: number, lateralSpeed: number, lowSpeedThreshold: number): number {
	return Math.atan(lateralSpeed / Math.max(Math.abs(longitudinalSpeed), lowSpeedThreshold));
}

/**
 * Pneu com curva de Pacejka simplificada por direção e atrito combinado por escorregamento normalizado:
 * com sx = κ/κpico, sy = α/αpico e s = |(sx, sy)|, cada força usa a sua curva em s (no pico de cada uma quando
 * s = 1) e a fração sx/s ou sy/s. Assim a força fica dentro da elipse de atrito (μx·Fz, μy·Fz).
 * Força proporcional à carga normal. Sem estado nem alocação.
 */
export default class Tire {
	/** Escorregamento longitudinal do pico (adimensional) */
	readonly peakSlipRatio: number;
	/** Ângulo de deriva do pico (rad) */
	readonly peakSlipAngle: number;

	constructor(readonly config: Readonly<VehicleTireConfig>) {
		this.peakSlipRatio = peakSlip(config.longitudinal);
		this.peakSlipAngle = peakSlip(config.lateral);
	}

	/**
	 * Forças combinadas (N): longitudinal com o sinal de κ, lateral oposta a α
	 * @param ratio escorregamento longitudinal κ (adimensional)
	 * @param angle ângulo de deriva α (rad)
	 * @param normalLoad carga normal Fz (N); sem carga, sem força
	 */
	computeForces(ratio: number, angle: number, normalLoad: number, out: TireForces): TireForces {
		const sx = ratio / this.peakSlipRatio;
		const sy = angle / this.peakSlipAngle;
		const s = Math.hypot(sx, sy);
		if (normalLoad <= 0 || s < 1e-12) {
			out.longitudinal = 0;
			out.lateral = 0;
			return out;
		}
		const { longitudinal, lateral } = this.config;
		out.longitudinal =
			(longitudinal.peakFriction * normalLoad * magicFormula(longitudinal, s * this.peakSlipRatio) * sx) / s;
		out.lateral = -(lateral.peakFriction * normalLoad * magicFormula(lateral, s * this.peakSlipAngle) * sy) / s;
		return out;
	}
}
