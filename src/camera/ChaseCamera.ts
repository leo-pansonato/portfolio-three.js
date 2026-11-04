import * as THREE from "three";
import { SpringState, stepCriticalSpring, stepCriticalSpringVector, wrapAngle } from "./criticalSpring";

/** Parâmetros da câmera de perseguição; tempos em s, distâncias em m, ângulos de FOV em graus */
export interface ChaseCameraSettings {
	/** Constante de tempo da mola da posição */
	readonly positionTimeConstant: number;
	/** Constante de tempo da mola do rumo (direção da câmera) */
	readonly headingTimeConstant: number;
	/** Fração da guinada seguida sem atraso pelo rumo (0–1); o resto atrasa a câmera em curva */
	readonly headingFeedForward: number;
	readonly lookAheadTimeConstant: number;
	readonly fovTimeConstant: number;
	/** Look-ahead à frente por velocidade de avanço (m por m/s) */
	readonly lookAheadPerSpeed: number;
	readonly maxLookAhead: number;
	/** Look-ahead lateral para o lado da curva (m por rad/s de guinada) */
	readonly lookAheadPerYawRate: number;
	readonly maxLateralLookAhead: number;
	/** Aumento do FOV por velocidade (graus por m/s) */
	readonly fovPerSpeed: number;
	readonly maxFovIncrease: number;
	/** Folga entre a câmera e o obstáculo atingido pelo raio */
	readonly collisionMargin: number;
	/** Distância mínima da câmera ao ponto de mira quando há obstáculo */
	readonly minDistance: number;
	/** Constante de tempo do afastamento depois que o obstáculo sai do caminho */
	readonly collisionRecoveryTimeConstant: number;
	/** Salto do pivô num quadro acima do qual a câmera reposiciona sem mola (teleporte) */
	readonly snapDistance: number;
}

export const DEFAULT_CHASE_CAMERA_SETTINGS: ChaseCameraSettings = {
	positionTimeConstant: 0.08,
	headingTimeConstant: 0.25,
	headingFeedForward: 0.6,
	lookAheadTimeConstant: 0.35,
	fovTimeConstant: 0.6,
	lookAheadPerSpeed: 0.1,
	maxLookAhead: 4,
	lookAheadPerYawRate: 1.5,
	maxLateralLookAhead: 1.5,
	fovPerSpeed: 0.2,
	maxFovIncrease: 10,
	collisionMargin: 0.25,
	minDistance: 1,
	collisionRecoveryTimeConstant: 0.4,
	snapDistance: 20,
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
	/** FOV vertical parado */
	fov: number;
}

/** Raio contra o cenário: distância (m) ao primeiro obstáculo, ou null. `direction` é unitária. */
export type CameraRaycast = (
	origin: Readonly<THREE.Vector3>,
	direction: Readonly<THREE.Vector3>,
	maxDistance: number,
) => number | null;

/**
 * Câmera de perseguição em 3ª pessoa, sem DOM nem cena: molas críticas na posição, no rumo, no look-ahead e no FOV,
 * todas em forma fechada (independentes do FPS), e colisão por raio do ponto de mira até a câmera.
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
	private readonly fovSpring: SpringState = { value: 60, velocity: 0 };
	private readonly springPosition = new THREE.Vector3();
	private readonly springVelocity = new THREE.Vector3();
	private readonly lookAhead = new THREE.Vector3();
	private readonly lookAheadVelocity = new THREE.Vector3();
	private readonly lastPivot = new THREE.Vector3();
	private readonly lastDesiredVelocity = new THREE.Vector3();
	private collisionDistance = Infinity;

	private readonly _forward = new THREE.Vector3();
	private readonly _desired = new THREE.Vector3();
	private readonly _desiredVelocity = new THREE.Vector3();
	private readonly _lookAheadTarget = new THREE.Vector3();
	private readonly _lookAheadTargetVelocity = new THREE.Vector3();
	private readonly _anchor = new THREE.Vector3();
	private readonly _direction = new THREE.Vector3();

	constructor(settings: ChaseCameraSettings = DEFAULT_CHASE_CAMERA_SETTINGS) {
		this.settings = settings;
	}

	/** Próximo update posiciona a câmera direto no alvo, sem mola (troca de modo, teleporte) */
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
		const pivot = target.position;
		const snap = this.needsSnap || pivot.distanceTo(this.lastPivot) > s.snapDistance;
		this.lastPivot.copy(pivot);

		const forward = this._forward.set(1, 0, 0).applyQuaternion(target.quaternion);
		const horizontal = Math.hypot(forward.x, forward.z);
		const carHeading = horizontal > 0.1 ? Math.atan2(forward.z, forward.x) : this.heading.value;
		const yawRate = -target.angularVelocity.y;
		const headingTarget = this.heading.value + wrapAngle(carHeading - this.heading.value);

		if (snap) {
			this.heading.value = carHeading;
			this.heading.velocity = 0;
		} else {
			stepCriticalSpring(this.heading, headingTarget, yawRate, dt, s.headingTimeConstant, s.headingFeedForward);
			this.heading.value = wrapAngle(this.heading.value);
		}

		const heading = this.heading.value;
		const cosH = Math.cos(heading);
		const sinH = Math.sin(heading);
		const view = heading + orbitYaw;
		const cosE = Math.cos(orbitElevation);
		const horizontalDistance = framing.distance * cosE;
		const desired = this._desired.set(
			pivot.x - Math.cos(view) * horizontalDistance,
			pivot.y + framing.height + framing.distance * Math.sin(orbitElevation),
			pivot.z - Math.sin(view) * horizontalDistance,
		);

		const velocity = target.velocity;
		const headingRate = snap ? 0 : this.heading.velocity;
		const desiredVelocity = this._desiredVelocity.set(
			velocity.x + Math.sin(view) * horizontalDistance * headingRate,
			velocity.y,
			velocity.z - Math.cos(view) * horizontalDistance * headingRate,
		);
		if (snap) this.lastDesiredVelocity.copy(desiredVelocity);
		const meanDesiredVelocity = this.lastDesiredVelocity.add(desiredVelocity).multiplyScalar(0.5);
		const forwardSpeed = velocity.x * cosH + velocity.z * sinH;
		const ahead = Math.min(s.maxLookAhead, Math.max(0, forwardSpeed) * s.lookAheadPerSpeed);
		const lateral = THREE.MathUtils.clamp(
			yawRate * s.lookAheadPerYawRate,
			-s.maxLateralLookAhead,
			s.maxLateralLookAhead,
		);
		this._lookAheadTarget.set(cosH * ahead - sinH * lateral, 0, sinH * ahead + cosH * lateral);
		// taxa do alvo pela rotação do rumo (look-ahead constante em regime de curva)
		this._lookAheadTargetVelocity.set(
			-this._lookAheadTarget.z * headingRate,
			0,
			this._lookAheadTarget.x * headingRate,
		);

		const speed = Math.hypot(velocity.x, velocity.z);
		const fovTarget = framing.fov + Math.min(s.maxFovIncrease, speed * s.fovPerSpeed);

		if (snap) {
			this.springPosition.copy(desired);
			this.springVelocity.copy(desiredVelocity);
			this.lookAhead.copy(this._lookAheadTarget);
			this.lookAheadVelocity.set(0, 0, 0);
			this.fovSpring.value = fovTarget;
			this.fovSpring.velocity = 0;
			this.collisionDistance = Infinity;
			this.needsSnap = false;
		} else {
			stepCriticalSpringVector(
				this.springPosition,
				this.springVelocity,
				desired,
				meanDesiredVelocity,
				dt,
				s.positionTimeConstant,
				1,
			);
			stepCriticalSpringVector(
				this.lookAhead,
				this.lookAheadVelocity,
				this._lookAheadTarget,
				this._lookAheadTargetVelocity,
				dt,
				s.lookAheadTimeConstant,
			);
			stepCriticalSpring(this.fovSpring, fovTarget, 0, dt, s.fovTimeConstant);
		}

		this.lastDesiredVelocity.copy(desiredVelocity);

		const anchor = this._anchor.set(pivot.x, pivot.y + framing.lookAtHeight, pivot.z);
		this.lookAt.copy(anchor).add(this.lookAhead);
		this.fov = this.fovSpring.value;

		const direction = this._direction.subVectors(this.springPosition, anchor);
		const length = direction.length();
		if (!raycast || length < 1e-6) {
			this.position.copy(this.springPosition);
			return;
		}
		direction.divideScalar(length);

		const hit = raycast(anchor, direction, length + s.collisionMargin);
		const allowed = hit === null ? length : Math.min(length, Math.max(s.minDistance, hit - s.collisionMargin));
		if (allowed < this.collisionDistance) {
			this.collisionDistance = allowed;
		} else {
			this.collisionDistance +=
				(allowed - this.collisionDistance) * (1 - Math.exp(-dt / s.collisionRecoveryTimeConstant));
		}
		this.position.copy(anchor).addScaledVector(direction, Math.min(length, this.collisionDistance));
	}
}
