/**
 * Contrato `VehicleState` (ARCHITECTURE §5): estado de runtime de uma instância de veículo.
 * Dono: o veículo que o criou; só o controle (VehicleControl e seu Powertrain) o altera, a cada passo de física.
 */
export interface VehicleState {
	/** Esterço atual das rodas dianteiras (rad; positivo vira à esquerda, ADR-0002) */
	steeringAngle: number;
	/** Velocidade ao longo de +X local do chassi no início do passo (m/s; negativa em ré) */
	forwardSpeed: number;
	/** Multiplicador do torque do motor (1 sem boost) */
	boostMultiplier: number;
	/** Rotação do motor no início do passo (rpm), copiada do trem de força (VehiclePhysics) */
	engineRpm: number;
	/** Marcha engatada: 1…n à frente, 0 ponto morto, −1 ré */
	gear: number;
	/** Tempo restante da troca de marcha em curso (s; 0 sem troca) */
	shiftTimeRemaining: number;
}

export const REVERSE_GEAR = -1;
export const NEUTRAL_GEAR = 0;

export function createVehicleState(idleRpm = 0): VehicleState {
	return {
		steeringAngle: 0,
		forwardSpeed: 0,
		boostMultiplier: 1,
		engineRpm: idleRpm,
		gear: 1,
		shiftTimeRemaining: 0,
	};
}
