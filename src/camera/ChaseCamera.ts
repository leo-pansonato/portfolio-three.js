import * as THREE from "three";
import { SpringState, stepCriticalSpring, wrapAngle } from "./criticalSpring";

/** Parâmetros da câmera de perseguição; tempos em s, distâncias em m, velocidades em m/s */
export interface ChaseCameraSettings {
	/** Constante de tempo da mola do rumo; só suaviza transições, sem atraso em curva constante */
	readonly headingTimeConstant: number;
	/** Faixa de velocidade de avanço em que o rumo passa da frente do chassi para o vetor de movimento */
	readonly velocityHeadingMinSpeed: number;
	readonly velocityHeadingFullSpeed: number;
	/** Folga entre a câmera e o obstáculo atingido pelo raio */
	readonly collisionMargin: number;
	/** Distância mínima da câmera ao ponto de mira quando há obstáculo */
	readonly minDistance: number;
	/** Constante de tempo do afastamento depois que o obstáculo sai do caminho */
	readonly collisionRecoveryTimeConstant: number;
}

export const DEFAULT_CHASE_CAMERA_SETTINGS: ChaseCameraSettings = {
	headingTimeConstant: 0.15,
	velocityHeadingMinSpeed: 1,
	velocityHeadingFullSpeed: 5,
	collisionMargin: 0.25,
	minDistance: 1,
	collisionRecoveryTimeConstant: 0.4,
};

/** Veículo seguido, em eixos do mundo; o chassi tem a frente em +X local (ADR-0002) */
export interface ChaseTarget {
	/** Pivô da câmera (m) */
	readonly position: Readonly<THREE.Vector3>;
	readonly quaternion: Readonly<THREE.Quaternion>;
	/** Velocidade linear (m/s) */
	readonly velocity: Readonly<THREE.Vector3>;
	/** Velocidade angular (rad/s) */
	readonly angularVelocity: Readonly<THREE.Vector3>;
}

/** Enquadramento do veículo (m, graus) */
export interface ChaseFraming {
	/** Distância da câmera ao pivô */
	distance: number;
	/** Altura da câmera acima do pivô */
	height: number;
	/** Altura do ponto de mira acima do pivô */
	lookAtHeight: number;
	/** FOV vertical */
	fov: number;
}

/** Raio contra o cenário: distância (m) ao primeiro obstáculo, ou null. `direction` é unitária. */
export type CameraRaycast = (
	origin: Readonly<THREE.Vector3>,
	direction: Readonly<THREE.Vector3>,
	maxDistance: number,
) => number | null;

/**
 * Câmera de perseguição em 3ª pessoa, sem DOM nem cena: órbita rígida em volta do pivô (distância, altura e FOV fixos),
 * alinhada ao vetor de movimento. Só o rumo tem mola (crítica, forma fechada, independente do FPS), com a guinada
 * do carro como antecipação, então numa curva constante não há atraso. Colisão por raio do ponto de mira até a câmera.
 * Ângulos do jogador: `orbitYaw` positivo olha para a direita, `orbitElevation` positivo eleva a câmera (rad).
 */
export default class ChaseCamera {
	/** Saída: posição da câmera (m) */
	readonly position = new THREE.Vector3();
	/** Saída: ponto para onde a câmera olha (m) */
	readonly lookAt = new THREE.Vector3();
	/** Saída: FOV vertical (graus) */
	fov = 60;

	private readonly settings: ChaseCameraSettings;
	private needsSnap = true;
	private readonly heading: SpringState = { value: 0, velocity: 0 };
	private collisionDistance = Infinity;

	private readonly _forward = new THREE.Vector3();
	private readonly _direction = new THREE.Vector3();

	constructor(settings: ChaseCameraSettings = DEFAULT_CHASE_CAMERA_SETTINGS) {
		this.settings = settings;
	}

	/** Próximo update alinha a câmera direto ao carro, sem mola (troca de modo, teleporte, troca de veículo) */
	reset(): void {
		this.needsSnap = true;
	}

	/** Distância atual liberada pela colisão (m); Infinity sem obstáculo registrado */
	get obstructedDistance(): number {
		return this.collisionDistance;
	}

	/**
	 * Avança a câmera por dt (s) de quadro
	 * @param raycast consulta ao cenário; sem ela, não há colisão
	 */
	update(
		dt: number,
		target: ChaseTarget,
		framing: Readonly<ChaseFraming>,
		orbitYaw: number,
		orbitElevation: number,
		raycast?: CameraRaycast,
	): void {
		const s = this.settings;
		const headingTarget = this.headingOf(target);

		if (this.needsSnap) {
			this.heading.value = headingTarget;
			this.heading.velocity = 0;
			this.collisionDistance = Infinity;
			this.needsSnap = false;
		} else {
			const yawRate = -target.angularVelocity.y;
			const unwrapped = this.heading.value + wrapAngle(headingTarget - this.heading.value);
			stepCriticalSpring(this.heading, unwrapped, yawRate, dt, s.headingTimeConstant, 1);
			this.heading.value = wrapAngle(this.heading.value);
		}

		const pivot = target.position;
		const view = this.heading.value + orbitYaw;
		const horizontalDistance = framing.distance * Math.cos(orbitElevation);
		this.lookAt.set(pivot.x, pivot.y + framing.lookAtHeight, pivot.z);
		this.position.set(
			pivot.x - Math.cos(view) * horizontalDistance,
			pivot.y + framing.height + framing.distance * Math.sin(orbitElevation),
			pivot.z - Math.sin(view) * horizontalDistance,
		);
		this.fov = framing.fov;

		if (raycast) this.resolveCollision(dt, raycast);
	}

	/** Rumo (rad, a partir de +X girando para +Z): frente do chassi parado ou em ré, vetor de movimento em marcha */
	private headingOf(target: ChaseTarget): number {
		const s = this.settings;
		const forward = this._forward.set(1, 0, 0).applyQuaternion(target.quaternion);
		const chassisHeading =
			Math.hypot(forward.x, forward.z) > 0.1 ? Math.atan2(forward.z, forward.x) : this.heading.value;

		const velocity = target.velocity;
		const forwardSpeed = velocity.x * forward.x + velocity.z * forward.z;
		const weight = THREE.MathUtils.smoothstep(forwardSpeed, s.velocityHeadingMinSpeed, s.velocityHeadingFullSpeed);
		if (weight === 0) return chassisHeading;
		const velocityHeading = Math.atan2(velocity.z, velocity.x);
		return chassisHeading + weight * wrapAngle(velocityHeading - chassisHeading);
	}

	/** Aproxima na hora quando o raio do ponto de mira até a câmera bate no cenário; afasta suave depois */
	private resolveCollision(dt: number, raycast: CameraRaycast): void {
		const s = this.settings;
		const direction = this._direction.subVectors(this.position, this.lookAt);
		const length = direction.length();
		if (length < 1e-6) return;
		direction.divideScalar(length);

		const hit = raycast(this.lookAt, direction, length + s.collisionMargin);
		const allowed = hit === null ? length : Math.min(length, Math.max(s.minDistance, hit - s.collisionMargin));
		if (allowed < this.collisionDistance) {
			this.collisionDistance = allowed;
		} else {
			this.collisionDistance +=
				(allowed - this.collisionDistance) * (1 - Math.exp(-dt / s.collisionRecoveryTimeConstant));
		}
		this.position.copy(this.lookAt).addScaledVector(direction, Math.min(length, this.collisionDistance));
	}
}
