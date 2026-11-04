import * as THREE from "three";
import ChaseCamera, { CameraRaycast, ChaseFraming } from "../camera/ChaseCamera";
import { wrapAngle } from "../camera/criticalSpring";
import { CameraConfig, CameraMode } from "../data/vehicles";
import { LookInput } from "../input/InputFrame";
import { createRaycastHit, PhysicsWorld } from "../physics/PhysicsWorld";
import GameComponent from "./GameComponent";
import Player from "./Player";

/**
 * Câmera do jogador: perseguição em 3ª pessoa (ChaseCamera) e câmeras presas ao chassi (capô e 1ª pessoa).
 * Olhar livre pelo mouse (ponteiro travado) e pelo analógico direito, com auto-centro ao soltar.
 * Sem `physicsWorld`, a perseguição usa a pose do fim do passo e não colide com o cenário.
 */
export default class CameraController extends GameComponent {
	private readonly camera: THREE.PerspectiveCamera;
	private readonly target: Player;
	private readonly look: Readonly<LookInput>;
	private readonly physicsWorld: PhysicsWorld | null;

	private currentMode: CameraMode = CameraMode.FIRST_PERSON;
	private readonly availableModes: CameraMode[] = [CameraMode.THIRD_PERSON, CameraMode.HOOD, CameraMode.FIRST_PERSON];

	/** Olhar do jogador relativo ao veículo (rad): + direita, + cima */
	private lookYaw = 0;
	private lookPitch = 0;

	private readonly MOUSE_SENSITIVITY = 0.002; // rad/px
	private readonly AUTO_CENTER_DELAY = 0.6; // s
	private readonly AUTO_CENTER_RATE = 3.0; // 1/s
	private readonly RIGID_MAX_YAW = 2.0; // rad
	private readonly RIGID_MAX_PITCH = 1.0;
	private readonly CHASE_MIN_ELEVATION = -0.2;
	private readonly CHASE_MAX_ELEVATION = 1.2;

	private readonly chase = new ChaseCamera();
	private readonly chaseTarget = {
		position: new THREE.Vector3(),
		quaternion: new THREE.Quaternion(),
		velocity: new THREE.Vector3(),
		angularVelocity: new THREE.Vector3(),
	};
	private readonly framing: ChaseFraming = { distance: 0, height: 0, lookAtHeight: 0, fov: 60 };
	private readonly raycast: CameraRaycast | undefined;
	private readonly hit = createRaycastHit();

	private readonly _lookAtPos = new THREE.Vector3();
	private readonly _offset = new THREE.Vector3();
	private readonly _up = new THREE.Vector3();
	private readonly _lookEuler = new THREE.Euler(0, 0, 0, "YXZ");

	constructor(
		camera: THREE.PerspectiveCamera,
		target: Player,
		look: Readonly<LookInput>,
		physicsWorld: PhysicsWorld | null = null,
	) {
		super();
		this.camera = camera;
		this.target = target;
		this.look = look;
		this.physicsWorld = physicsWorld;

		if (physicsWorld) {
			this.raycast = (origin, direction, maxDistance) =>
				physicsWorld.castRayWithNormal(
					origin,
					direction,
					maxDistance,
					this.hit,
					this.target.physics.chassisBody,
				)
					? this.hit.distance
					: null;
		}
	}

	cycleCameraMode() {
		const currentIndex = this.availableModes.indexOf(this.currentMode);
		const nextIndex = (currentIndex + 1) % this.availableModes.length;
		this.currentMode = this.availableModes[nextIndex];

		this.lookYaw = 0;
		this.lookPitch = 0;
		this.chase.reset();
		this.camera.up.set(0, 1, 0);

		console.log("Camera Mode:", this.currentMode);
	}

	update(deltaTime: number): void {
		const config = this.target.getCameraConfig()[this.currentMode];
		const rigid = this.currentMode !== CameraMode.THIRD_PERSON;

		this.updateLook(deltaTime, rigid);

		if (rigid) {
			this.updateRigidCamera(config);
			this.camera.fov = config.fov || 75;
		} else {
			this.updateChaseCamera(deltaTime, config);
		}

		this.camera.updateProjectionMatrix();
	}

	/** Mouse (px → rad) e analógico (rad/s → rad), limites por modo e auto-centro */
	private updateLook(deltaTime: number, rigid: boolean): void {
		const look = this.look;
		if (look.pointerLocked) {
			this.lookYaw += look.deltaX * this.MOUSE_SENSITIVITY;
			this.lookPitch -= look.deltaY * this.MOUSE_SENSITIVITY;
		}
		this.lookYaw += look.yawRate * deltaTime;
		this.lookPitch += look.pitchRate * deltaTime;

		if (rigid) {
			this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -this.RIGID_MAX_YAW, this.RIGID_MAX_YAW);
			this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -this.RIGID_MAX_PITCH, this.RIGID_MAX_PITCH);
		} else {
			this.lookYaw = wrapAngle(this.lookYaw);
			this.lookPitch = THREE.MathUtils.clamp(
				this.lookPitch,
				-this.CHASE_MAX_ELEVATION,
				-this.CHASE_MIN_ELEVATION,
			);
		}

		if (look.secondsSinceMove > this.AUTO_CENTER_DELAY) {
			const keep = Math.exp(-this.AUTO_CENTER_RATE * deltaTime);
			this.lookYaw *= keep;
			this.lookPitch *= keep;
		}
	}

	/** Perseguição: pivô no mesh (pose interpolada), rumo e velocidades do chassi */
	private updateChaseCamera(deltaTime: number, config: CameraConfig): void {
		const target = this.chaseTarget;
		const body = this.target.physics.chassisBody;
		target.position.copy(this.target.getPosition());
		if (!this.physicsWorld?.getInterpolatedPose(body, this._offset, target.quaternion)) {
			body.getRotation(target.quaternion);
		}
		body.getLinearVelocity(target.velocity);
		body.getAngularVelocity(target.angularVelocity);

		const framing = this.framing;
		framing.distance = config.distance;
		framing.height = config.height;
		framing.lookAtHeight = config.lookAtOffset.y;
		framing.fov = config.fov || 60;

		this.chase.update(deltaTime, target, framing, this.lookYaw, -this.lookPitch, this.raycast);

		this.camera.up.set(0, 1, 0);
		this.camera.position.copy(this.chase.position);
		this.camera.lookAt(this.chase.lookAt);
		this.camera.fov = this.chase.fov;
	}

	/** Capô e 1ª pessoa: offset e olhar no referencial do mesh do veículo (frente em +Z do modelo) */
	private updateRigidCamera(config: CameraConfig): void {
		const carQuaternion = this.target.getQuaternion();
		if (!carQuaternion) return;
		const carPosition = this.target.getPosition();

		this.camera.up.copy(this._up.set(0, 1, 0).applyQuaternion(carQuaternion));

		this._offset.set(config.offset?.x ?? 0.175, config.offset?.y ?? 0.53, config.offset?.z ?? -0.2);
		this._offset.applyQuaternion(carQuaternion);
		this.camera.position.copy(carPosition).add(this._offset);

		this._lookEuler.set(-this.lookPitch, -this.lookYaw, 0);
		this._lookAtPos.set(0, 0, 20).applyEuler(this._lookEuler).applyQuaternion(carQuaternion);
		this._lookAtPos.add(this.camera.position);
		this.camera.lookAt(this._lookAtPos);
	}
}
