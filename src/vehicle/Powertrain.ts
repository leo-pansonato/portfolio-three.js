import { VehiclePowertrainConfig } from "../data/vehicles/types";
import { REVERSE_GEAR, VehicleState } from "./VehicleState";

const RAD_PER_SECOND_TO_RPM = 60 / (2 * Math.PI);
/** Resto de arredondamento ao descontar passos do tempo de troca (s) */
const SHIFT_TIME_EPSILON = 1e-9;
/** Faixa abaixo do corte em que o torque cai linearmente a zero (rpm) */
const REV_LIMITER_RAMP_RPM = 200;
/** Faixa abaixo da velocidade máxima em que o torque cai linearmente a zero (m/s) */
const SPEED_LIMITER_RAMP = 1;

function ramp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Pedido de tração para um passo */
export interface PowertrainRequest {
	/** Acelerador (0–1) */
	throttle: number;
	/** Engatar a ré (true) ou uma marcha à frente (false) */
	reverse: boolean;
	boost: boolean;
}

/**
 * Motor (curva de torque, marcha lenta, corte de giro), câmbio automático com histerese e diferencial.
 * Sem embreagem nem conversor (ADR-0003, etapa 4): a rotação vem da velocidade das rodas motrizes,
 * limitada por baixo pela marcha lenta; a inércia do motor é refletida nas rodas (reflectedInertia).
 * O câmbio decide pela velocidade do veículo (como a central do câmbio), para não caçar marcha com a roda patinando.
 * Altera só o VehicleState recebido; sem alocação por passo.
 */
export default class Powertrain {
	constructor(
		private readonly config: Readonly<VehiclePowertrainConfig>,
		/** Raio da roda (m) */
		private readonly wheelRadius: number,
		private readonly state: VehicleState,
	) {}

	/**
	 * Avança um passo de física e devolve o torque total nas rodas motrizes (N·m; negativo em ré)
	 * @param forwardSpeed velocidade ao longo de +X local do chassi (m/s): troca de marcha e limitador de velocidade
	 * @param dt passo de física (s)
	 * @param drivelineSpeed velocidade média da banda de rodagem das rodas motrizes ω·r (m/s): rotação do motor
	 */
	step(
		request: Readonly<PowertrainRequest>,
		forwardSpeed: number,
		dt: number,
		drivelineSpeed: number = forwardSpeed,
	): number {
		const config = this.config;
		const state = this.state;

		const shiftTimeRemaining = state.shiftTimeRemaining - dt;
		state.shiftTimeRemaining = shiftTimeRemaining > SHIFT_TIME_EPSILON ? shiftTimeRemaining : 0;
		if (request.reverse !== (state.gear === REVERSE_GEAR)) {
			state.gear = request.reverse ? REVERSE_GEAR : 1;
			state.shiftTimeRemaining = 0;
		} else if (state.gear !== REVERSE_GEAR && state.shiftTimeRemaining === 0) {
			this.selectForwardGear(forwardSpeed);
		}

		const ratio = this.overallRatio(state.gear);
		state.engineRpm = Math.max(config.idleRpm, this.drivelineRpm(drivelineSpeed, ratio));
		state.boostMultiplier = request.boost ? config.boostTorqueMultiplier : 1;

		if (request.throttle <= 0 || state.shiftTimeRemaining > 0 || state.engineRpm >= config.revLimitRpm) return 0;

		let torque = this.torqueAt(state.engineRpm) * request.throttle * state.boostMultiplier;
		torque *= ramp((config.revLimitRpm - state.engineRpm) / REV_LIMITER_RAMP_RPM);
		if (state.gear !== REVERSE_GEAR) {
			torque *= ramp((config.topSpeed - forwardSpeed) / SPEED_LIMITER_RAMP);
		}
		const wheelTorque = torque * ratio * config.efficiency;
		return state.gear === REVERSE_GEAR ? -wheelTorque : wheelTorque;
	}

	/** Torque a plena carga na rotação dada (N·m), interpolado na curva */
	torqueAt(rpm: number): number {
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

	/** Relação total da caixa com o diferencial na marcha dada (adimensional) */
	overallRatio(gear: number): number {
		const config = this.config;
		const gearbox = gear === REVERSE_GEAR ? config.reverseRatio : config.gearRatios[gear - 1];
		return gearbox * config.finalDriveRatio;
	}

	/** Inércia do motor refletida no conjunto das rodas motrizes na marcha engatada (kg·m²): J·G²·η */
	reflectedInertia(): number {
		const ratio = this.overallRatio(this.state.gear);
		return this.config.engineInertia * ratio * ratio * this.config.efficiency;
	}

	/** Rotação do motor ditada pelas rodas (rpm) */
	private drivelineRpm(drivelineSpeed: number, overallRatio: number): number {
		return (Math.abs(drivelineSpeed) / this.wheelRadius) * overallRatio * RAD_PER_SECOND_TO_RPM;
	}

	private selectForwardGear(vehicleSpeed: number): void {
		const config = this.config;
		const state = this.state;
		const rpm = this.drivelineRpm(vehicleSpeed, this.overallRatio(state.gear));
		if (state.gear < config.gearRatios.length && rpm >= config.upshiftRpm) {
			state.gear++;
			state.shiftTimeRemaining = config.shiftTime;
		} else if (state.gear > 1 && rpm < config.downshiftRpm) {
			const lowerRpm = this.drivelineRpm(vehicleSpeed, this.overallRatio(state.gear - 1));
			if (lowerRpm < config.upshiftRpm) {
				state.gear--;
				state.shiftTimeRemaining = config.shiftTime;
			}
		}
	}
}
