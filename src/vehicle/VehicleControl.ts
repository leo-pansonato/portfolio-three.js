import { VehicleDefinition, VehicleDrivingConfig } from "../data/vehicles/types";
import { InputFrame } from "../input/InputFrame";
import Powertrain, { PowertrainRequest } from "./Powertrain";
import { VehicleState } from "./VehicleState";

/** Saída do controle para a física do veículo */
export interface VehicleCommands {
	/** Esterço das rodas dianteiras (rad; positivo vira à esquerda) */
	steeringAngle: number;
	/** Torque do motor por roda motriz (N·m; negativo em ré) */
	driveTorque: number;
	/** Torque de freio por roda (N·m) */
	brakeTorque: number;
	/** Torque do freio de mão por roda traseira (N·m) */
	handbrakeTorque: number;
	/** Inércia do motor refletida em cada roda motriz na marcha engatada (kg·m²) */
	drivelineInertia: number;
}

/**
 * Converte o InputFrame em comandos, a cada passo de física (dt fixo):
 * rampa e retorno do volante, trem de força (Powertrain), freio, ré, freio de mão, boost e resistência ao rolamento.
 * Altera apenas o VehicleState recebido; sem THREE nem DOM.
 */
export default class VehicleControl {
	readonly commands: VehicleCommands = {
		steeringAngle: 0,
		driveTorque: 0,
		brakeTorque: 0,
		handbrakeTorque: 0,
		drivelineInertia: 0,
	};
	readonly powertrain: Powertrain;

	private readonly config: VehicleDrivingConfig;
	private readonly drivenWheelCount: number;
	private readonly powertrainRequest: PowertrainRequest = { throttle: 0, reverse: false, boost: false };

	constructor(
		definition: Readonly<VehicleDefinition>,
		private readonly state: VehicleState,
	) {
		this.config = definition.configs;
		this.drivenWheelCount = this.config.tractionDisplacement === "all" ? 4 : 2;
		this.powertrain = new Powertrain(definition.powertrain, definition.physics.wheelRadius, state);
	}

	/**
	 * @param forwardSpeed velocidade ao longo da frente do chassi (m/s)
	 * @param dt passo de física (s)
	 * @param drivelineSpeed velocidade média da banda de rodagem das rodas motrizes ω·r (m/s), para a rotação do motor
	 */
	step(input: InputFrame, forwardSpeed: number, dt: number, drivelineSpeed: number = forwardSpeed): VehicleCommands {
		this.state.forwardSpeed = forwardSpeed;
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

		let brakeTorque = 0;
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
			brakeTorque = config.brakeTorque * brakeValue;
		}

		if (input.handbrake) {
			handbrakeTorque = config.handbrakeTorque;
		}

		if (throttleValue === 0 && brakeValue === 0) {
			brakeTorque = config.rollingResistanceTorque;
		}

		const wheelTorque = this.powertrain.step(request, this.state.forwardSpeed, dt, drivelineSpeed);

		this.commands.driveTorque = wheelTorque / this.drivenWheelCount;
		this.commands.brakeTorque = brakeTorque;
		this.commands.handbrakeTorque = handbrakeTorque;
		this.commands.drivelineInertia = this.powertrain.reflectedInertia() / this.drivenWheelCount;
	}
}
