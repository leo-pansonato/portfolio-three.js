import { TorqueConverterConfig } from "../data/vehicles/types";
import { RAD_PER_SECOND_TO_RPM } from "./Engine";

/**
 * Conversor de torque simples (ADR-0003, etapa 4). Com relação de velocidade SR = ωturbina/ωbomba:
 * torque na bomba = (ω/K)², com K = ωestol/√Testol, até o ponto de acoplamento SRc e caindo linearmente a zero em
 * SR = 1; torque na turbina = TR·torque na bomba, com TR caindo de TRestol (SR = 0) a 1 (SR = SRc). Com a turbina
 * mais rápida (freio-motor) o papel das duas se inverte, sem multiplicação. Sem estado nem alocação.
 */
export default class TorqueConverter {
	/** Capacidade K (rad/s por √(N·m)) */
	readonly capacityFactor: number;

	/**
	 * @param stallTorque torque do motor a plena carga na rotação de estol (N·m)
	 */
	constructor(
		private readonly config: Readonly<TorqueConverterConfig>,
		stallTorque: number,
	) {
		this.capacityFactor = config.stallRpm / RAD_PER_SECOND_TO_RPM / Math.sqrt(stallTorque);
	}

	/**
	 * Torque na bomba, do motor para o conversor (N·m; negativo quando a turbina arrasta o motor)
	 * @param pumpSpeed rotação do motor (rad/s, ≥ 0)
	 * @param turbineSpeed rotação da entrada do câmbio (rad/s)
	 */
	pumpTorque(pumpSpeed: number, turbineSpeed: number): number {
		const turbine = Math.max(0, turbineSpeed);
		const pump = Math.max(0, pumpSpeed);
		if (pump >= turbine) return this.couplingTorque(pump, turbine);
		return -this.couplingTorque(turbine, pump);
	}

	/** Torque na turbina, do conversor para o câmbio (N·m), com as mesmas entradas de pumpTorque */
	turbineTorque(pumpSpeed: number, turbineSpeed: number): number {
		const torque = this.pumpTorque(pumpSpeed, turbineSpeed);
		if (torque <= 0 || pumpSpeed <= 0) return torque;
		const config = this.config;
		const speedRatio = Math.max(0, turbineSpeed) / pumpSpeed;
		if (speedRatio >= config.couplingSpeedRatio) return torque;
		return (
			torque *
			(config.stallTorqueRatio - ((config.stallTorqueRatio - 1) * speedRatio) / config.couplingSpeedRatio)
		);
	}

	/** Torque com o lado motor mais rápido (`driver` ≥ `driven` ≥ 0, rad/s) */
	private couplingTorque(driver: number, driven: number): number {
		if (driver <= 0) return 0;
		const k = this.capacityFactor;
		const base = (driver * driver) / (k * k);
		const couplingRatio = this.config.couplingSpeedRatio;
		const speedRatio = driven / driver;
		if (speedRatio <= couplingRatio) return base;
		return (base * (1 - speedRatio)) / (1 - couplingRatio);
	}
}
