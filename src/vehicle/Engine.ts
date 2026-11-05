import { VehiclePowertrainConfig } from "../data/vehicles/types";

export const RAD_PER_SECOND_TO_RPM = 60 / (2 * Math.PI);
/** Faixa abaixo do corte em que o acelerador efetivo cai linearmente a zero (rpm) */
const REV_LIMITER_RAMP_RPM = 200;
/** Faixa acima da marcha lenta em que o controle de lenta abre o acelerador, todo na lenta (rpm) */
export const IDLE_GOVERNOR_BAND_RPM = 20;

function ramp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Motor (ADR-0003, etapas 1 e 4): curva de torque a plena carga, arrasto sem acelerador (freio-motor), controle de
 * marcha lenta e corte de giro, como torque líquido no virabrequim em função da rotação. Sem estado: a rotação é do
 * trem de força (Driveline). Com o acelerador efetivo a, torque = a·Tplena·multiplicador − (1 − a)·Tarrasto.
 */
export default class Engine {
	/** Maior torque da curva a plena carga (N·m) */
	readonly peakTorque: number;

	constructor(private readonly config: Readonly<VehiclePowertrainConfig>) {
		let peak = 0;
		for (const point of config.torqueCurve) peak = Math.max(peak, point.torque);
		this.peakTorque = peak;
	}

	/** Torque a plena carga na rotação dada (N·m), interpolado na curva */
	fullLoadTorque(rpm: number): number {
		const curve = this.config.torqueCurve;
		if (rpm <= curve[0].rpm) return curve[0].torque;
		for (let i = 1; i < curve.length; i++) {
			const next = curve[i];
			if (rpm <= next.rpm) {
				const previous = curve[i - 1];
				const t = (rpm - previous.rpm) / (next.rpm - previous.rpm);
				return previous.torque + (next.torque - previous.torque) * t;
			}
		}
		return curve[curve.length - 1].torque;
	}

	/** Torque de arrasto sem acelerador na rotação dada (N·m, ≥ 0) */
	frictionTorque(rpm: number): number {
		const config = this.config;
		const t = ramp((rpm - config.idleRpm) / (config.revLimitRpm - config.idleRpm));
		return config.friction.idleTorque + (config.friction.revLimitTorque - config.friction.idleTorque) * t;
	}

	/**
	 * Acelerador efetivo (0–1): o maior entre o pedido e o do controle de lenta, cortado nos últimos 200 rpm antes do
	 * corte de giro
	 */
	effectiveThrottle(rpm: number, throttle: number): number {
		const config = this.config;
		const governor = ramp((config.idleRpm + IDLE_GOVERNOR_BAND_RPM - rpm) / IDLE_GOVERNOR_BAND_RPM);
		return Math.max(throttle, governor) * (1 - this.revLimiterCut(rpm));
	}

	/** Fração do acelerador retirada pelo corte de giro na rotação dada (0 abaixo da rampa, 1 no corte) */
	revLimiterCut(rpm: number): number {
		return 1 - ramp((this.config.revLimitRpm - rpm) / REV_LIMITER_RAMP_RPM);
	}

	/**
	 * Torque líquido no virabrequim (N·m)
	 * @param angularVelocity rotação do motor (rad/s)
	 * @param throttle acelerador pedido (0–1)
	 * @param torqueMultiplier multiplicador do torque a plena carga (boost)
	 */
	torque(angularVelocity: number, throttle: number, torqueMultiplier: number): number {
		const rpm = angularVelocity * RAD_PER_SECOND_TO_RPM;
		const effective = this.effectiveThrottle(rpm, throttle);
		return effective * this.fullLoadTorque(rpm) * torqueMultiplier - (1 - effective) * this.frictionTorque(rpm);
	}
}
