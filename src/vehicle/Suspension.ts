import { VehicleSuspensionConfig } from "../data/vehicles/types";

/** Resultado de uma roda no último `computeForces`; forças ao longo da normal de contato (N) */
export interface SuspensionWheel {
	inContact: boolean;
	/** Comprimento da suspensão, da fixação ao centro da roda (m) */
	length: number;
	/** Compressão a partir do comprimento livre (m; positiva comprimida) */
	compression: number;
	/** Velocidade de compressão (m/s; positiva comprimindo) */
	compressionRate: number;
	springForce: number;
	damperForce: number;
	bumpStopForce: number;
	antiRollForce: number;
	/** Força total sobre o chassi (N, ≥ 0: o pneu só empurra) */
	force: number;
}

/** Amortecedor assimétrico (N; positivo empurra o chassi para longe do chão) */
export function damperForce(config: Readonly<VehicleSuspensionConfig>, compressionRate: number): number {
	const damping = compressionRate > 0 ? config.compressionDamping : config.reboundDamping;
	return damping * compressionRate;
}

/** Batente progressivo: zero até `maxCompression − bumpStopLength`, depois rigidez × penetração² (N) */
export function bumpStopForce(config: Readonly<VehicleSuspensionConfig>, compression: number): number {
	const penetration = compression - (config.maxCompression - config.bumpStopLength);
	return penetration > 0 ? config.bumpStopStiffness * penetration * penetration : 0;
}

/**
 * Suspensão própria por roda (ADR-0003, etapa 2): mola, amortecedor, batente e barra estabilizadora por eixo
 * (rodas 0/1 dianteiras, 2/3 traseiras).
 * Só calcula forças a partir da medição de cada roda; quem mede (raio) e aplica é o VehiclePhysics.
 * Sem alocação por passo.
 */
export default class Suspension {
	readonly wheels: SuspensionWheel[] = [];

	/**
	 * @param restLength comprimento livre (m), também a extensão máxima
	 */
	constructor(
		private readonly config: Readonly<VehicleSuspensionConfig>,
		readonly restLength: number,
		wheelCount = 4,
	) {
		for (let i = 0; i < wheelCount; i++) {
			this.wheels.push({
				inContact: false,
				length: restLength,
				compression: 0,
				compressionRate: 0,
				springForce: 0,
				damperForce: 0,
				bumpStopForce: 0,
				antiRollForce: 0,
				force: 0,
			});
		}
	}

	/**
	 * Medição de uma roda no estado atual; sem contato a roda fica estendida
	 * @param length comprimento (m), limitado a [0, restLength]
	 * @param compressionRate velocidade de compressão (m/s; positiva comprimindo)
	 */
	setContact(index: number, inContact: boolean, length: number, compressionRate: number): void {
		const wheel = this.wheels[index];
		wheel.inContact = inContact;
		wheel.length = inContact ? Math.min(this.restLength, Math.max(0, length)) : this.restLength;
		wheel.compression = this.restLength - wheel.length;
		wheel.compressionRate = inContact ? compressionRate : 0;
	}

	/** Forças de todas as rodas a partir das medições atuais */
	computeForces(): void {
		const config = this.config;
		const wheels = this.wheels;
		for (let i = 0; i < wheels.length; i++) {
			const wheel = wheels[i];
			wheel.springForce = config.springRate * wheel.compression;
			wheel.damperForce = damperForce(config, wheel.compressionRate);
			wheel.bumpStopForce = bumpStopForce(config, wheel.compression);
			wheel.antiRollForce = 0;
		}

		if (wheels.length >= 2) this.applyAntiRoll(0, 1, config.antiRollStiffness.front);
		if (wheels.length >= 4) this.applyAntiRoll(2, 3, config.antiRollStiffness.rear);

		for (let i = 0; i < wheels.length; i++) {
			const wheel = wheels[i];
			wheel.force = wheel.inContact
				? Math.max(0, wheel.springForce + wheel.damperForce + wheel.bumpStopForce + wheel.antiRollForce)
				: 0;
		}
	}

	/** Barra estabilizadora entre as rodas esquerda e direita de um eixo (rigidez em N/m) */
	private applyAntiRoll(left: number, right: number, stiffness: number): void {
		const force = stiffness * (this.wheels[left].compression - this.wheels[right].compression);
		this.wheels[left].antiRollForce = force;
		this.wheels[right].antiRollForce = -force;
	}
}
