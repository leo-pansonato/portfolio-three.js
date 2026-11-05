import { VehiclePowertrainConfig } from "../data/vehicles/types";
import { DrivelineCommands } from "./Driveline";
import { RAD_PER_SECOND_TO_RPM } from "./Engine";
import { NEUTRAL_GEAR, REVERSE_GEAR, VehicleState } from "./VehicleState";

/** Resto de arredondamento ao descontar passos do tempo de troca (s) */
const SHIFT_TIME_EPSILON = 1e-9;
/** Faixa abaixo da velocidade máxima em que o acelerador cai linearmente a zero (m/s) */
const SPEED_LIMITER_RAMP = 1;
/**
 * Na troca, o acelerador fecha de todo com o motor esta rotação acima da entrada do câmbio e abre de todo com ele
 * esta rotação abaixo (rpm)
 */
const REV_MATCH_BAND_RPM = 500;

function ramp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Relação total da caixa com o diferencial na marcha dada (adimensional; negativa em ré, 0 em ponto morto) */
export function gearRatio(config: Readonly<VehiclePowertrainConfig>, gear: number): number {
	if (gear === NEUTRAL_GEAR) return 0;
	if (gear === REVERSE_GEAR) return -config.reverseRatio * config.finalDriveRatio;
	return config.gearRatios[gear - 1] * config.finalDriveRatio;
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
 * Central do motor e do câmbio automático (ADR-0003, etapas 1 e 4): escolhe a marcha pela velocidade do veículo
 * para a frente (andando de ré, as marchas à frente ficam na 1ª), com histerese, e comanda acelerador, embreagem e conversor para o trem de força (Driveline), que é dono da rotação
 * do motor. Embreagem: fecha com a rotação da entrada do câmbio (rodando) e, sem conversor, também com a do motor
 * quando há acelerador (arrancada). Na troca, embreagem e conversor abrem e voltam a acoplar ao longo do tempo de
 * troca, e o acelerador leva o motor à rotação nova (corta com o motor acima dela, abre com ele abaixo). Com conversor,
 * ele desacopla o motor parado sem acelerador. Ponto morto (marcha 0) só sai com acelerador ou ré.
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
	 * Avança um passo de física e escreve os comandos do trem de força em `out`
	 * @param forwardSpeed velocidade ao longo de +X local do chassi (m/s): troca de marcha e limitador de velocidade
	 * @param dt passo de física (s)
	 * @param drivelineSpeed velocidade da saída do câmbio em unidades de banda de rodagem, ω·r (m/s)
	 */
	step(
		request: Readonly<PowertrainRequest>,
		forwardSpeed: number,
		dt: number,
		drivelineSpeed: number,
		out: DrivelineCommands,
	): void {
		const config = this.config;
		const state = this.state;

		const shiftTimeRemaining = state.shiftTimeRemaining - dt;
		state.shiftTimeRemaining = shiftTimeRemaining > SHIFT_TIME_EPSILON ? shiftTimeRemaining : 0;
		if (request.reverse !== (state.gear === REVERSE_GEAR)) {
			state.gear = request.reverse ? REVERSE_GEAR : 1;
			state.shiftTimeRemaining = 0;
		}
		// marchas à frente pela velocidade para a frente: andando para trás conta como parado (fica na 1ª)
		const shiftSpeed = Math.max(0, forwardSpeed);
		if (state.gear === NEUTRAL_GEAR && request.throttle > 0) {
			state.gear = this.gearForSpeed(shiftSpeed);
			state.shiftTimeRemaining = 0;
		} else if (state.gear > 0 && state.shiftTimeRemaining === 0) {
			this.selectForwardGear(shiftSpeed);
		}

		const ratio = this.overallRatio(state.gear);
		state.boostMultiplier = request.boost ? config.boostTorqueMultiplier : 1;
		out.gearRatio = ratio;
		out.torqueMultiplier = state.boostMultiplier;

		let throttle = request.throttle;
		if (state.gear > 0) throttle *= ramp((config.topSpeed - forwardSpeed) / SPEED_LIMITER_RAMP);
		if (ratio === 0) {
			out.throttle = throttle;
			out.clutchTorque = 0;
			out.converterCoupling = 0;
			return;
		}

		const inputRpm = (drivelineSpeed / this.wheelRadius) * ratio * RAD_PER_SECOND_TO_RPM;
		const idle = config.idleRpm;
		const clutch = config.clutch;
		const engagementBand = clutch.engagementRpm - clutch.engagementStartRpm;
		let engagement = ramp((inputRpm - clutch.engagementStartRpm) / engagementBand);
		if (!config.torqueConverter && throttle > 0) {
			engagement = Math.max(engagement, ramp((state.engineRpm - clutch.engagementStartRpm) / engagementBand));
		}
		let coupling = config.torqueConverter ? Math.max(throttle > 0 ? 1 : 0, ramp((inputRpm - idle) / idle)) : 0;
		if (state.shiftTimeRemaining > 0) {
			const progress = 1 - state.shiftTimeRemaining / config.shiftTime;
			engagement *= progress;
			coupling *= progress;
			const excessRpm = state.engineRpm - inputRpm;
			throttle =
				excessRpm >= 0
					? throttle * ramp(1 - excessRpm / REV_MATCH_BAND_RPM)
					: Math.max(throttle, ramp(-excessRpm / REV_MATCH_BAND_RPM));
		}
		out.throttle = throttle;
		out.clutchTorque = engagement * clutch.maxTorque;
		out.converterCoupling = coupling;
	}

	/** Relação total da caixa com o diferencial na marcha dada (adimensional; negativa em ré, 0 em ponto morto) */
	overallRatio(gear: number): number {
		return gearRatio(this.config, gear);
	}

	/** Rotação da entrada do câmbio na marcha dada com o veículo na velocidade dada (rpm; velocidade ≥ 0) */
	private drivelineRpm(vehicleSpeed: number, gear: number): number {
		return (vehicleSpeed / this.wheelRadius) * Math.abs(this.overallRatio(gear)) * RAD_PER_SECOND_TO_RPM;
	}

	/** Menor marcha à frente em que a rotação fica abaixo do giro de troca */
	private gearForSpeed(vehicleSpeed: number): number {
		let gear = 1;
		while (
			gear < this.config.gearRatios.length &&
			this.drivelineRpm(vehicleSpeed, gear) >= this.config.upshiftRpm
		) {
			gear++;
		}
		return gear;
	}

	private selectForwardGear(vehicleSpeed: number): void {
		const config = this.config;
		const state = this.state;
		const rpm = this.drivelineRpm(vehicleSpeed, state.gear);
		if (state.gear < config.gearRatios.length && rpm >= config.upshiftRpm) {
			state.gear++;
			state.shiftTimeRemaining = config.shiftTime;
		} else if (state.gear > 1 && rpm < config.downshiftRpm) {
			const lowerRpm = this.drivelineRpm(vehicleSpeed, state.gear - 1);
			if (lowerRpm < config.upshiftRpm) {
				state.gear--;
				state.shiftTimeRemaining = config.shiftTime;
			}
		}
	}
}
