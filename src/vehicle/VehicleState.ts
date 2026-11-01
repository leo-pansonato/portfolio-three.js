/**
 * Contrato `VehicleState` (ARCHITECTURE §5): estado de runtime de uma instância de veículo.
 * Dono: o veículo que o criou; só o controle (VehicleControl) o altera, a cada passo de física.
 */
export interface VehicleState {
	/** Esterço atual das rodas dianteiras (rad; positivo vira à esquerda, ADR-0002) */
	steeringAngle: number;
	/** Velocidade ao longo de +X local do chassi no início do passo (m/s; negativa em ré) */
	forwardSpeed: number;
	/** Multiplicador da força do motor (1 sem boost) */
	boostMultiplier: number;
}

export function createVehicleState(): VehicleState {
	return { steeringAngle: 0, forwardSpeed: 0, boostMultiplier: 1 };
}
