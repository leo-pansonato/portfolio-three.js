import { VehicleAerodynamicsConfig } from "../data/vehicles/types";
import { Vec3Like } from "../physics/PhysicsWorld";

/** Densidade do ar ao nível do mar a 15 °C (kg/m³) */
export const AIR_DENSITY = 1.225;

/**
 * Módulo da força de arrasto 0,5·ρ·Cd·A·v² (N)
 * @param speed módulo da velocidade em relação ao ar (m/s)
 */
export function aerodynamicDragForce(config: Readonly<VehicleAerodynamicsConfig>, speed: number): number {
	return 0.5 * AIR_DENSITY * config.dragCoefficient * config.frontalArea * speed * speed;
}

/**
 * Impulso de arrasto de um passo (N·s), oposto à velocidade, escrito em `out`
 * @param velocity velocidade do chassi no mundo (m/s)
 * @param dt passo de física (s)
 */
export function aerodynamicDragImpulse<T extends Vec3Like>(
	config: Readonly<VehicleAerodynamicsConfig>,
	velocity: Readonly<Vec3Like>,
	dt: number,
	out: T,
): T {
	const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
	const scale = speed > 0 ? (-aerodynamicDragForce(config, speed) * dt) / speed : 0;
	out.x = velocity.x * scale;
	out.y = velocity.y * scale;
	out.z = velocity.z * scale;
	return out;
}
