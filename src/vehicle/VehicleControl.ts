import { VehicleDefinition, VehicleDrivingConfig } from "../data/vehicles/types";
import { InputFrame } from "../input/InputFrame";
import { DrivelineCommands } from "./Driveline";
import Powertrain, { PowertrainRequest } from "./Powertrain";
import { VehicleState } from "./VehicleState";

/** Saída do controle para a física do veículo: esterço, freios e comandos do trem de força */
export interface VehicleCommands extends DrivelineCommands {
	/** Esterço das rodas dianteiras (rad; positivo vira à esquerda) */
	steeringAngle: number;
	/** Torque de freio por roda dianteira (N·m) */
	frontBrakeTorque: number;
	/** Torque de freio por roda traseira (N·m) */
	rearBrakeTorque: number;
	/** Torque do freio de mão por roda traseira (N·m) */
	handbrakeTorque: number;
}

/**
 * Converte o InputFrame em comandos, a cada passo de física (dt fixo):
 * rampa e retorno do volante, trem de força (Powertrain), freio, ré, freio de mão, boost e resistência ao rolamento.
 * Altera apenas o VehicleState recebido; sem THREE nem DOM.
 */
export default class VehicleControl {
	readonly commands: VehicleCommands = {
		steeringAngle: 0,
		frontBrakeTorque: 0,
		rearBrakeTorque: 0,
		handbrakeTorque: 0,
		throttle: 0,
		torqueMultiplier: 1,
		gearRatio: 0,
		clutchTorque: 0,
		converterCoupling: 0,
	};
	readonly powertrain: Powertrain;

	private readonly config: VehicleDrivingConfig;
	private readonly powertrainRequest: PowertrainRequest = { throttle: 0, reverse: false, boost: false };

	constructor(
		definition: Readonly<VehicleDefinition>,
		private readonly state: VehicleState,
	) {
		this.config = definition.configs;
		this.powertrain = new Powertrain(definition.powertrain, definition.physics.wheelRadius, state);
	}

	/**
	 * @param forwardSpeed velocidade ao longo da frente do chassi (m/s)
	 * @param dt passo de física (s)
	 * @param drivelineSpeed velocidade da saída do câmbio em unidades de banda de rodagem ω·r (m/s), para a embreagem
	 * @param engineRpm rotação do motor no início do passo (rpm), do trem de força
	 */
	step(
		input: InputFrame,
		forwardSpeed: number,
		dt: number,
		drivelineSpeed: number = forwardSpeed,
		engineRpm: number = this.state.engineRpm,
	): VehicleCommands {
		this.state.forwardSpeed = forwardSpeed;
		this.state.engineRpm = engineRpm;
		this.updateSteering(input, dt);
		this.updateDriving(input, dt, drivelineSpeed);
		return this.commands;
	}

	private updateSteering(input: InputFrame, timeStep: number): void {
		const config = this.config;
		const state = this.state;
		// no controlador, ângulo positivo (em torno de +Y) vira à esquerda
		const steerInput = input.steer * -1;
		const targetSteering = steerInput * config.maxSteerVal;

		// resposta do volante cai com a velocidade e o retorno acelera
		const speedFactor = Math.min(Math.abs(state.forwardSpeed) / 100, 1);
		const effectiveSteerSpeed = config.steerSpeed * (1 - speedFactor * 0.5);
		const effectiveReturnSpeed = config.steerReturn * (1 + speedFactor * 0.5);

		if (targetSteering !== 0) {
			if (state.steeringAngle < targetSteering) {
				state.steeringAngle += effectiveSteerSpeed * timeStep;
				if (state.steeringAngle > targetSteering) {
					state.steeringAngle = targetSteering;
				}
			} else if (state.steeringAngle > targetSteering) {
				state.steeringAngle -= effectiveSteerSpeed * timeStep;
				if (state.steeringAngle < targetSteering) {
					state.steeringAngle = targetSteering;
				}
			}
		} else {
			// retorno automático ao centro
			if (Math.abs(state.steeringAngle) < effectiveReturnSpeed * timeStep) {
				state.steeringAngle = 0;
			} else if (state.steeringAngle > 0) {
				state.steeringAngle -= effectiveReturnSpeed * timeStep;
			} else if (state.steeringAngle < 0) {
				state.steeringAngle += effectiveReturnSpeed * timeStep;
			}
		}

		this.commands.steeringAngle = state.steeringAngle;
	}

	private updateDriving(input: InputFrame, dt: number, drivelineSpeed: number): void {
		const config = this.config;
		const isAlmostStopped = this.state.forwardSpeed < 2.0;
		const throttleValue = input.throttle;
		const brakeValue = input.brake;
		const request = this.powertrainRequest;

		let frontBrakeTorque = 0;
		let rearBrakeTorque = 0;
		let handbrakeTorque = 0;

		const reversing = brakeValue > 0 && isAlmostStopped && throttleValue === 0;

		request.boost = input.boost;
		if (throttleValue > 0) {
			request.throttle = throttleValue;
			request.reverse = false;
		} else if (reversing) {
			request.throttle = brakeValue;
			request.reverse = true;
		} else {
			request.throttle = 0;
		}

		if (brakeValue > 0 && !reversing) {
			frontBrakeTorque = config.brakeTorque.front * brakeValue;
			rearBrakeTorque = config.brakeTorque.rear * brakeValue;
		}

		if (input.handbrake) {
			handbrakeTorque = config.handbrakeTorque;
		}

		if (throttleValue === 0 && brakeValue === 0) {
			frontBrakeTorque = config.rollingResistanceTorque;
			rearBrakeTorque = config.rollingResistanceTorque;
		}

		this.powertrain.step(request, this.state.forwardSpeed, dt, drivelineSpeed, this.commands);

		this.commands.frontBrakeTorque = frontBrakeTorque;
		this.commands.rearBrakeTorque = rearBrakeTorque;
		this.commands.handbrakeTorque = handbrakeTorque;
	}
}
