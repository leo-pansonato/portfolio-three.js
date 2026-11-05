import { VehicleDefinition } from "../data/vehicles/types";
import { STANDARD_GRAVITY, VehicleTelemetry } from "../vehicle/VehicleTelemetry";

/** Parâmetros do som do veículo em um quadro, calculados da telemetria (sem Web Audio, testável em Node) */
export interface VehicleSoundParams {
	/** Frequência de ignição do motor (Hz) */
	engineFrequencyHz: number;
	/** Ganho do motor (0–1) */
	engineGain: number;
	/** Corte do passa-baixas do motor (Hz) */
	engineCutoffHz: number;
	/** Ganho do chiado dos pneus (0–1) */
	tireGain: number;
	/** Centro do chiado (Hz) */
	tireFrequencyHz: number;
	/** Ganho do vento (0–1) */
	windGain: number;
	/** Ganho do rolamento no piso (0–1) */
	roadGain: number;
}

const TUNING = {
	/** Escorregamento combinado (em múltiplos do pico) em que o chiado começa e em que satura */
	squealStart: 0.7,
	squealFull: 2,
	/** Velocidade do contato que libera o chiado por inteiro (m/s) */
	squealSpeed: 4,
	tireBaseHz: 650,
	tireSpanHz: 450,
	/** Velocidade com vento pleno (m/s) */
	windFullSpeed: 75,
	/** Velocidade com rolamento pleno (m/s) */
	roadFullSpeed: 45,
	/** Aceleração horizontal do chassi acima da qual há impacto, e a de impacto pleno (g) */
	impactThresholdG: 3,
	impactFullG: 15,
};

export function createVehicleSoundParams(): VehicleSoundParams {
	return {
		engineFrequencyHz: 0,
		engineGain: 0,
		engineCutoffHz: 0,
		tireGain: 0,
		tireFrequencyHz: TUNING.tireBaseHz,
		windGain: 0,
		roadGain: 0,
	};
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Som do quadro a partir da telemetria do último passo (carga do motor da simulação, vale também no replay) */
export function computeVehicleSound(
	telemetry: Readonly<VehicleTelemetry>,
	definition: Readonly<VehicleDefinition>,
	out: VehicleSoundParams,
): VehicleSoundParams {
	const sound = definition.sound;
	const powertrain = definition.powertrain;
	const rpm = Math.max(telemetry.engineRpm, 0);
	const rpmNorm = clamp01((rpm - powertrain.idleRpm) / (powertrain.revLimitRpm - powertrain.idleRpm));
	const load = clamp01(telemetry.engineLoad);

	out.engineFrequencyHz = (rpm / 60) * (sound.cylinders / 2);
	out.engineGain = clamp01(0.3 + 0.3 * rpmNorm + 0.4 * load);
	out.engineCutoffHz =
		sound.idleCutoffHz + (sound.fullLoadCutoffHz - sound.idleCutoffHz) * clamp01(0.6 * load + 0.4 * rpmNorm);

	// chiado: o escorregamento combinado acima do pico, pesado pela carga da roda e pela velocidade do contato
	const staticLoad = (definition.physics.mass * STANDARD_GRAVITY) / Math.max(telemetry.wheels.length, 1);
	const radius = definition.physics.wheelRadius;
	let squeal = 0;
	let contacts = 0;
	for (let i = 0; i < telemetry.wheels.length; i++) {
		const wheel = telemetry.wheels[i];
		if (!wheel.inContact) continue;
		contacts++;
		const excess = clamp01((wheel.normalizedSlip - TUNING.squealStart) / (TUNING.squealFull - TUNING.squealStart));
		const contactSpeed = Math.max(telemetry.speed, Math.abs(wheel.angularVelocity) * radius);
		const gate = clamp01(contactSpeed / TUNING.squealSpeed);
		const loadWeight = clamp01(wheel.suspensionForce / staticLoad);
		squeal = Math.max(squeal, excess * gate * Math.sqrt(loadWeight));
	}
	out.tireGain = squeal;
	out.tireFrequencyHz = TUNING.tireBaseHz + TUNING.tireSpanHz * squeal;

	const windRatio = telemetry.speed / TUNING.windFullSpeed;
	out.windGain = clamp01(windRatio * windRatio);
	out.roadGain = contacts > 0 ? clamp01(telemetry.speed / TUNING.roadFullSpeed) : 0;
	return out;
}

/** Intensidade de impacto (0–1; 0 sem impacto) pela aceleração horizontal do chassi no último passo */
export function impactIntensity(telemetry: Readonly<VehicleTelemetry>): number {
	const accelerationG = Math.hypot(telemetry.longitudinalAccelerationG, telemetry.lateralAccelerationG);
	if (accelerationG < TUNING.impactThresholdG) return 0;
	return clamp01(
		0.2 + (0.8 * (accelerationG - TUNING.impactThresholdG)) / (TUNING.impactFullG - TUNING.impactThresholdG),
	);
}
