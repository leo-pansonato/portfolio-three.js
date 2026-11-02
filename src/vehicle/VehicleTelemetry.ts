/**
 * Telemetria do veículo ao fim do último passo de física; reescrita no lugar por VehiclePhysics.
 * Eixos do chassi (ADR-0002): frente +X, cima +Y, direita +Z.
 */
export interface WheelTelemetry {
	inContact: boolean;
	/** Comprimento da suspensão (m) */
	suspensionLength: number;
	/** Compressão a partir do repouso (m; positiva comprimida) */
	compression: number;
	/** Força da suspensão (N) */
	suspensionForce: number;
	/** Impulso longitudinal do pneu no passo (N·s; positivo para a frente da roda) */
	forwardImpulse: number;
	/** Impulso lateral do pneu no passo (N·s; positivo ao longo do eixo da roda, +Z) */
	sideImpulse: number;
	/** Esterço (rad; positivo à esquerda) */
	steering: number;
	/** Velocidade angular da roda (rad/s; positiva rolando para a frente) */
	angularVelocity: number;
	/** Escorregamento longitudinal (adimensional; positivo tracionando) */
	slipRatio: number;
	/** Ângulo de deriva (rad; positivo com o contato indo para a direita da roda) */
	slipAngle: number;
	/** Força longitudinal do pneu (N; positiva para a frente da roda) */
	longitudinalForce: number;
	/** Força lateral do pneu (N; positiva para a direita da roda) */
	lateralForce: number;
	/** Torque do trem de força na roda (N·m; 0 nas não motrizes) */
	driveTorque: number;
}

export interface VehicleTelemetry {
	/** Passo de física em que foi medida (s) */
	timeStep: number;
	/** Módulo da velocidade do chassi (m/s) */
	speed: number;
	/** Velocidade ao longo de +X local (m/s) */
	forwardSpeed: number;
	/** Velocidade ao longo de +Z local (m/s) */
	lateralSpeed: number;
	/** Aceleração ao longo de +X local no último passo (g) */
	longitudinalAccelerationG: number;
	/** Aceleração ao longo de +Z local no último passo (g) */
	lateralAccelerationG: number;
	/** Esterço das rodas dianteiras (rad; positivo à esquerda) */
	steeringAngle: number;
	/** Rotação do motor (rpm) */
	engineRpm: number;
	/** Marcha engatada: 1…n à frente, 0 ponto morto, −1 ré */
	gear: number;
	/** Rotação do motor menos a da entrada do câmbio (rpm) */
	clutchSlipRpm: number;
	/** Embreagem (ou travamento do conversor) travada no último passo */
	clutchLocked: boolean;
	wheels: WheelTelemetry[];
}

export const STANDARD_GRAVITY = 9.80665;

export function createVehicleTelemetry(): VehicleTelemetry {
	return {
		timeStep: 0,
		speed: 0,
		forwardSpeed: 0,
		lateralSpeed: 0,
		longitudinalAccelerationG: 0,
		lateralAccelerationG: 0,
		steeringAngle: 0,
		engineRpm: 0,
		gear: 1,
		clutchSlipRpm: 0,
		clutchLocked: false,
		wheels: [],
	};
}

export function createWheelTelemetry(suspensionRestLength: number): WheelTelemetry {
	return {
		inContact: false,
		suspensionLength: suspensionRestLength,
		compression: 0,
		suspensionForce: 0,
		forwardImpulse: 0,
		sideImpulse: 0,
		steering: 0,
		angularVelocity: 0,
		slipRatio: 0,
		slipAngle: 0,
		longitudinalForce: 0,
		lateralForce: 0,
		driveTorque: 0,
	};
}
