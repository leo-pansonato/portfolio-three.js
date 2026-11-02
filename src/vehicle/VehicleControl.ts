import { VehicleDefinition, VehicleDrivingConfig } from "../data/vehicles/types";
import { InputFrame } from "../input/InputFrame";
import Powertrain, { PowertrainRequest } from "./Powertrain";
import { VehicleState } from "./VehicleState";

/** Saída do controle para a física do veículo */
export interface VehicleCommands {
	/** Esterço das rodas dianteiras (rad; positivo vira à esquerda) */
	steeringAngle: number;
	/** Força do motor por roda motriz (N; negativa em ré) */
	engineForce: number;
	/** Freio por roda (N) */
	brakeForce: number;
	/** Freio de mão por roda traseira (N) */
	handbrakeForce: number;
}

/**
 * Converte o InputFrame em comandos, a cada passo de física (dt fixo):
 * rampa e retorno do volante, trem de força (Powertrain), freio, ré, freio de mão, boost e resistência ao rolamento.
 * Altera apenas o VehicleState recebido; sem THREE nem DOM.
 */
export default class VehicleControl {
	readonly commands: VehicleCommands = { steeringAngle: 0, engineForce: 0, brakeForce: 0, handbrakeForce: 0 };
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
		this.powertrain = new Powertrain(
			definition.powertrain,
			definition.physics.wheelRadius,
			definition.physics.mass,
			state,
		);
	}

	/**
	 * @param forwardSpeed velocidade ao longo da frente do chassi (m/s)
	 * @param dt passo de física (s)
	 */
	step(input: InputFrame, forwardSpeed: number, dt: number): VehicleCommands {
		this.state.forwardSpeed = forwardSpeed;
		this.updateSteering(input, dt);
		this.updateDriving(input, dt);
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

	private updateDriving(input: InputFrame, dt: number): void {
		const config = this.config;
		const isAlmostStopped = this.state.forwardSpeed < 2.0;
		const throttleValue = input.throttle;
		const brakeValue = input.brake;
		const request = this.powertrainRequest;

		let brakeForce = 0;
		let handbrakeForce = 0;

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
			brakeForce = config.brakeForce * brakeValue;
		}

		if (input.handbrake) {
			handbrakeForce = config.eBrakeForce;
		}

		// o controlador do Rapier não tem resistência ao rolamento
		if (throttleValue === 0 && brakeValue === 0) {
			brakeForce = config.rollingResistance;
		}

		const wheelForce = this.powertrain.step(request, this.state.forwardSpeed, dt);

		this.commands.engineForce = wheelForce / this.drivenWheelCount;
		this.commands.brakeForce = brakeForce;
		this.commands.handbrakeForce = handbrakeForce;
	}
}
