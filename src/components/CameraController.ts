import * as THREE from "three";
import GameComponent from "./GameComponent";
import InputManager from "../managers/InputManager";
import { CameraConfig, CameraMode } from "../managers/VehicleManager";
import Player from "./Player";

export default class CameraController extends GameComponent {
	private camera: THREE.PerspectiveCamera;
	private target: Player | null;
	private inputManager: InputManager;

	private lastTargetPosition: THREE.Vector3 = new THREE.Vector3();

	private currentMode: CameraMode = CameraMode.FIRST_PERSON;
	private availableModes: CameraMode[] = [CameraMode.THIRD_PERSON, CameraMode.HOOD, CameraMode.FIRST_PERSON];

	private currentAngles = { yaw: 0, pitch: 0 };
	private targetAngles = { yaw: 0, pitch: 0 };

	private readonly MOUSE_SENSITIVITY = 0.002;
	private readonly AUTO_CENTER_DELAY = 2.0;
	private readonly AUTO_CENTER_SPEED = 3.0;
	private readonly SMOOTH_ROTATION_SPEED = 10.0;

	private _lookAtPos = new THREE.Vector3();
	private _offset = new THREE.Vector3();

	constructor(camera: THREE.PerspectiveCamera, target: Player, inputManager: InputManager) {
		super();
		this.camera = camera;
		this.target = target;
		this.inputManager = inputManager;

		if (this.target) {
			this.lastTargetPosition.copy(this.target.getPosition());
		}

		this.currentAngles.yaw = 0;
		this.targetAngles.yaw = 0;
	}

	cycleCameraMode() {
		const currentIndex = this.availableModes.indexOf(this.currentMode);

		// calcula o proximo fazendo o corte pelo tamanho do array
		const nextIndex = (currentIndex + 1) % this.availableModes.length;
		this.currentMode = this.availableModes[nextIndex];

		// Resetar angulos ao trocar
		this.targetAngles.yaw = 0;
		this.targetAngles.pitch = 0;
		this.currentAngles.yaw = 0;
		this.currentAngles.pitch = 0;

		console.log("Camera Mode:", this.currentMode);
	}

	update(deltaTime: number): void {
		if (!this.target) return;

		const currentTargetPos = this.target.getPosition();
		const config = this.target.getCameraConfig()[this.currentMode];

      this.camera.fov = config.fov || 75;

		// lógica de Rotação
		if (this.currentMode === CameraMode.FIRST_PERSON || this.currentMode === CameraMode.HOOD) {
			this.updateRigidCamera(deltaTime, config, currentTargetPos);
		} else {
			this.updateOrbitCamera(deltaTime, config, currentTargetPos);
		}

		this.camera.updateProjectionMatrix();
	}

	// Terceira Pessoa (orbital)
	private updateOrbitCamera(deltaTime: number, config: CameraConfig, targetPos: THREE.Vector3): void {
		// const carRotation = this.target!.getRotation();

		// Input Mouse
		const mouseDelta = this.inputManager.getAndResetMouseDelta();
		if (this.inputManager.isPointerLocked()) {
			this.targetAngles.yaw -= mouseDelta.x * this.MOUSE_SENSITIVITY;
			this.targetAngles.pitch += mouseDelta.y * this.MOUSE_SENSITIVITY;
			this.targetAngles.pitch = Math.max(-0.3, Math.min(1.5, this.targetAngles.pitch));
		}

		// --- AUTO CENTER ---
		/*
        if (this.inputManager.getTimeSinceLastInput() > this.AUTO_CENTER_DELAY) {
            const idealYaw = carRotation.y; 
            const t = 1.0 - Math.pow(0.01, deltaTime * this.AUTO_CENTER_SPEED);
            this.targetAngles.yaw = this.lerpAngle(this.targetAngles.yaw, idealYaw, t);
            this.targetAngles.pitch = THREE.MathUtils.lerp(this.targetAngles.pitch, 0.2, t);
        }
        */
		// ------------------------------

		// suavização
		const rotationSmoothness = deltaTime * this.SMOOTH_ROTATION_SPEED;
		this.currentAngles.yaw = this.lerpAngle(this.currentAngles.yaw, this.targetAngles.yaw, rotationSmoothness);
		this.currentAngles.pitch = THREE.MathUtils.lerp(this.currentAngles.pitch, this.targetAngles.pitch, rotationSmoothness);

		// posição
		let distance = config.distance;
		let heightOffset = config.height;
		const hDistance = distance * Math.cos(this.currentAngles.pitch);

		this._offset.set(
			hDistance * Math.sin(this.currentAngles.yaw),
			distance * Math.sin(this.currentAngles.pitch) + heightOffset,
			hDistance * Math.cos(this.currentAngles.yaw)
		);

		this.camera.position.copy(targetPos).add(this._offset);

		// olhar para o carro
		this._lookAtPos.copy(targetPos);
		if (config.lookAtOffset) {
			this._lookAtPos.y += config.lookAtOffset.y;
			this._lookAtPos.x += config.lookAtOffset.x || 0;
			this._lookAtPos.z += config.lookAtOffset.z || 0;
		}
		this.camera.lookAt(this._lookAtPos);
	}

	// Primeira Pessoa e Capô (rigida)
	private updateRigidCamera(deltaTime: number, config: CameraConfig, targetPos: THREE.Vector3): void {
		const carRotation = this.target!.getRotation();

		// configurar posição da camera
		const defaultX = 0.175;
		const defaultY = 0.53;
		const defaultZ = -0.2;

		this._offset.set(config.offset?.x ?? defaultX, config.offset?.y ?? defaultY, config.offset?.z ?? defaultZ);

		// aplica a rotação do carro ao offset para posicionar a câmera
      if (carRotation) this._offset.applyEuler(carRotation);
		this.camera.position.copy(targetPos).add(this._offset);

		// input do mouse
		const mouseDelta = this.inputManager.getAndResetMouseDelta();
		if (this.inputManager.isPointerLocked()) {
			this.targetAngles.yaw -= mouseDelta.x * this.MOUSE_SENSITIVITY;
			this.targetAngles.pitch -= mouseDelta.y * this.MOUSE_SENSITIVITY;
		}

		// limites de rotação
		this.targetAngles.pitch = Math.max(-1.0, Math.min(1.0, this.targetAngles.pitch));
		this.targetAngles.yaw = Math.max(-2.0, Math.min(2.0, this.targetAngles.yaw));

		// auto center
		if (this.inputManager.getTimeSinceLastInput() > 0.5) {
			const t = deltaTime * this.AUTO_CENTER_SPEED;
			this.targetAngles.yaw = THREE.MathUtils.lerp(this.targetAngles.yaw, 0, t);
			this.targetAngles.pitch = THREE.MathUtils.lerp(this.targetAngles.pitch, 0, t);
		}

		// vetor apontando para frente (Z+)
		const lookVector = new THREE.Vector3(0, 0, 20);

		// aplicar rotação do mouse no vetor
		lookVector.applyEuler(new THREE.Euler(-this.targetAngles.pitch, this.targetAngles.yaw, 0, "YXZ"));

		// aplicar rotação do CARRO no vetor
      if (carRotation) lookVector.applyEuler(carRotation);

		// somar posição da câmera para ter o ponto final no mundo 3D
		this._lookAtPos.copy(this.camera.position).add(lookVector);

		// olhar para esse ponto calculado
		this.camera.lookAt(this._lookAtPos);
	}

	private lerpAngle(start: number, end: number, t: number): number {
		let d = end - start;
		if (d > Math.PI) d -= 2 * Math.PI;
		if (d < -Math.PI) d += 2 * Math.PI;
		return start + d * t;
	}
}
