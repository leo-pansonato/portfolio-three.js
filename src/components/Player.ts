import * as THREE from "three";
import InputManager from "../managers/InputManager";
import PhysicsManager from "../managers/PhysicsManager";
import { CameraConfig, CameraMode, getVehicleDefinition, VehicleDefinition } from "../data/vehicles";
import VehicleManager from "../managers/VehicleManager";
import VehicleControl, { createDriverInput } from "../vehicle/VehicleControl";
import VehiclePhysics from "../vehicle/VehiclePhysics";
import { createVehicleState, VehicleState } from "../vehicle/VehicleState";
import Entity from "./Entity";

/**
 * Pose visual de cada roda, interpolada entre os dois últimos passos
 */
interface WheelInfo {
	/** Conexão da suspensão no chassi (m, eixos locais) */
	connectionPoint: THREE.Vector3;
	worldPosition: THREE.Vector3;
	worldQuaternion: THREE.Quaternion;
	/** Esterço (rad) */
	steering: number;
	/** Giro (rad) */
	rotation: number;
	isInContact: boolean;
	/** Comprimento da suspensão (m) */
	suspensionLength: number;
}

/**
 * Player jogável usando DynamicRayCastVehicleController do Rapier
 */
export default class Player extends Entity {
	private inputManager: InputManager;
	private physicsManager: PhysicsManager;
	private vehicleManager: VehicleManager;

	private currentVehicleId: string;
	private vehicleData!: VehicleDefinition;
	private state!: VehicleState;
	private control!: VehicleControl;
	private readonly driverInput = createDriverInput();

	public physics!: VehiclePhysics;

	// Informações das rodas
	private wheelInfos: WheelInfo[] = [];
	private readonly WHEEL_COUNT = 4;

	public declare mesh: THREE.Mesh | THREE.Object3D;
	private originalMesh!: THREE.Object3D;
	private wheelMeshes: THREE.Object3D[];

	// Cache de vetores para performance
	private tempVector3 = new THREE.Vector3();
	private tempQuaternion = new THREE.Quaternion();
	private tempSteeringQuat = new THREE.Quaternion();
	private tempSpinQuat = new THREE.Quaternion();
	private tempOffset = new THREE.Vector3();
	/** Pose do chassi interpolada entre os dois últimos passos (só visual) */
	private renderPosition = new THREE.Vector3();
	private renderQuaternion = new THREE.Quaternion();
	private loadRequestId = 0;
	private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);
	private static readonly AXIS_Z = new THREE.Vector3(0, 0, 1);

	// Callback para atualização do veículo no step da física
	private physicsPreStepCallback: ((dt: number) => void) | null = null;

	constructor(scene: THREE.Scene, inputManager: InputManager, physicsManager: PhysicsManager) {
		super(scene);
		this.inputManager = inputManager;
		this.physicsManager = physicsManager;
		this.vehicleManager = new VehicleManager(scene);

		// ID do veículo atual
		this.currentVehicleId = "bmw_f82"; // bmw_f82 / mercedes_g63

		this.wheelMeshes = [];

		// Inicializar a configuração do veículo
		this.initVehicleConfigs();

		// Inicializar o veículo físico
		this.initPhysics();

		// Inicializar o veículo visual
		this.initVisuals();

		// Adicionar veículo à cena
		this.addToScene();

		// Carregar o modelo do veículo
		this.loadVehicle(this.vehicleData);
	}

	initVehicleConfigs(): void {
		const vehicleConfig = getVehicleDefinition(this.currentVehicleId);
		if (!vehicleConfig) throw new Error(`Configuração do veículo ${this.currentVehicleId} não encontrada.`);

		this.vehicleData = vehicleConfig;
		this.state = createVehicleState();
		this.control = new VehicleControl(this.vehicleData.configs, this.state);
	}

	/**
	 * Cria a física do veículo e registra o controle no pré-passo
	 */
	initPhysics(): void {
		this.physics = new VehiclePhysics(this.physicsManager, this.vehicleData);
		this.wheelInfos = this.vehicleData.wheels.adjustments.map((wheel) => ({
			connectionPoint: new THREE.Vector3(wheel.position.x, wheel.position.y, wheel.position.z),
			worldPosition: new THREE.Vector3(),
			worldQuaternion: new THREE.Quaternion(),
			steering: 0,
			rotation: 0,
			isInContact: false,
			suspensionLength: this.vehicleData.physics.suspensionRestLength,
		}));

		// controle por passo: input mais recente → volante e forças → controlador
		this.physicsPreStepCallback = (dt: number) => {
			this.physics.savePreviousWheelStates();
			this.updateControl(dt);
			this.physics.updateVehicle(dt);
		};
		this.physicsManager.addPreStepCallback(this.physicsPreStepCallback);
	}

	/**
	 * Inicializar os elementos visuais do veículo
	 */
	initVisuals(): void {
		// Criar mesh básica de placeholder
		const chassisSize = this.vehicleData.physics.size;
		const chassisGeometry = new THREE.BoxGeometry(chassisSize.x, chassisSize.y, chassisSize.z);
		const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
		this.mesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		this.mesh.castShadow = true;

		// Criar mesh básica para as rodas
		this.wheelMeshes = [];
		const wheelRadius = this.vehicleData.physics.wheelRadius;
		const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 32);
		wheelGeometry.rotateX(Math.PI / 2);
		const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

		for (let i = 0; i < this.WHEEL_COUNT; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			this.scene.add(wheelMesh);
			this.wheelMeshes.push(wheelMesh);
		}

		// Guardar referência à mesh original
		this.originalMesh = this.mesh;

		// Adicionar o chassi ao gerenciador de física para sincronização
		this.physicsManager.addEntity(this.physics.chassisBody, this.mesh);
	}

	/**
	 * Carregar um veículo específico
	 */
	async loadVehicle(definition: VehicleDefinition): Promise<any> {
		try {
			const requestId = ++this.loadRequestId;
			const vehicleModels = await this.vehicleManager.loadVehicle(definition, this.WHEEL_COUNT);

			// outro veículo foi pedido enquanto este carregava
			if (requestId !== this.loadRequestId) {
				this.releaseObjects([vehicleModels.body, ...vehicleModels.wheels]);
				return;
			}

			this.releaseObjects([this.mesh, ...this.wheelMeshes]);

			// Atualizar a referência ao modelo do chassi
			if (vehicleModels.body) {
				this.mesh = vehicleModels.body;
				this.scene.add(this.mesh);
			}

			// Atualizar as referências às rodas
			if (vehicleModels.wheels) {
				this.wheelMeshes = vehicleModels.wheels;
			}
		} catch (error) {
			console.error(`Erro ao carregar veículo ${definition.body.modelPath}:`, error);
		}
	}

	/**
	 * Controle do veículo a cada passo de física (dt fixo, s)
	 */
	private updateControl(dt: number): void {
		const input = this.driverInput;
		input.throttle = this.inputManager.getThrottle();
		input.brake = this.inputManager.getBrake();
		input.steer = this.inputManager.getSteer();
		input.handbrake = this.inputManager.isActionActive("VEHICLE_HANDBRAKE");
		input.boost = this.inputManager.isActionActive("VEHICLE_BOOST");

		const commands = this.control.step(input, this.physics.forwardSpeed(), dt);
		this.physics.applyCommands(commands, dt);
	}

	/**
	 * Atualizar a visualização do veículo (por quadro; o controle roda em updateControl)
	 */
	update(_deltaTime: number): void {
		this.physicsManager.getInterpolatedPose(this.physics.chassisBody, this.renderPosition, this.renderQuaternion);

		// Atualizar informações das rodas
		this.updateWheelInfos(this.physicsManager.getInterpolationAlpha());

		// Atualizar o modelo visual do chassi
		this.updateChassisMesh();

		// Atualizar os modelos visuais das rodas
		this.updateWheelMeshes();
	}

	/**
	 * Atualiza as informações das rodas do controlador Rapier, interpoladas por alpha (0–1)
	 */
	private updateWheelInfos(alpha: number): void {
		for (let i = 0; i < this.wheelInfos.length; i++) {
			const wheelInfo = this.wheelInfos[i];
			const previous = this.physics.wheels[i];

			wheelInfo.isInContact = this.physics.wheelIsInContact(i);
			wheelInfo.suspensionLength = THREE.MathUtils.lerp(previous.previousSuspensionLength, this.physics.wheelSuspensionLength(i), alpha);
			wheelInfo.steering = THREE.MathUtils.lerp(previous.previousSteering, this.physics.wheelSteering(i), alpha);
			wheelInfo.rotation = THREE.MathUtils.lerp(previous.previousRotation, this.physics.wheelRotation(i), alpha);

			// Calcular posição e rotação da roda no mundo
			this.calculateWheelWorldTransform(wheelInfo);
		}
	}

	/**
	 * Calcula a transformação mundial da roda
	 */
	private calculateWheelWorldTransform(wheelInfo: WheelInfo): void {
		const chassisPos = this.renderPosition;
		this.tempQuaternion.copy(this.renderQuaternion);

		// Posição base da roda (ponto de conexão no chassi)
		this.tempVector3.copy(wheelInfo.connectionPoint);

		this.tempVector3.y -= wheelInfo.suspensionLength;

		// Transformar para coordenadas mundiais
		this.tempVector3.applyQuaternion(this.tempQuaternion);
		this.tempVector3.x += chassisPos.x;
		this.tempVector3.y += chassisPos.y;
		this.tempVector3.z += chassisPos.z;

		wheelInfo.worldPosition.copy(this.tempVector3);

		// Calcular rotação da roda
		this.tempSteeringQuat.setFromAxisAngle(Player.AXIS_Y, wheelInfo.steering);
		this.tempSpinQuat.setFromAxisAngle(Player.AXIS_Z, -wheelInfo.rotation);

		wheelInfo.worldQuaternion.copy(this.tempQuaternion);
		wheelInfo.worldQuaternion.multiply(this.tempSteeringQuat);
		wheelInfo.worldQuaternion.multiply(this.tempSpinQuat);
	}

	/**
	 * Atualizar o modelo visual do chassi
	 */
	updateChassisMesh(): void {
		if (this.mesh && this.mesh !== this.originalMesh) {
			const chassisAdjustment = this.vehicleData?.body || null;

			// Aplicar a pose interpolada e os ajustes à mesh do chassi
			this.fixCarAlignment(this.mesh, this.renderPosition, this.renderQuaternion, chassisAdjustment);
		}
	}

	/**
	 * Atualizar os modelos visuais das rodas
	 */
	updateWheelMeshes(): void {
		for (let i = 0; i < this.wheelInfos.length; i++) {
			const wheelInfo = this.wheelInfos[i];
			const wheelAdjustment = this.vehicleData?.wheels?.adjustments?.[i] || null;

			// Aplicar a transformação e ajustes à mesh da roda
			this.fixWheelAlignment(i, this.wheelMeshes[i], wheelInfo, wheelAdjustment);
		}
	}

	/**
	 * Fixa o alinhamento do chassi
	 */
	fixCarAlignment(
		carMesh: THREE.Object3D,
		position: { x: number; y: number; z: number },
		rotation: { x: number; y: number; z: number; w: number },
		adjustments: any
	): void {
		// Copiar a posição e rotação do corpo físico
		carMesh.position.set(position.x, position.y, position.z);
		carMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

		if (adjustments) {
			// Ajuste de posição
			if (adjustments.position) {
				const localOffset = this.tempOffset.set(adjustments.position.x, adjustments.position.y, adjustments.position.z);
				localOffset.applyQuaternion(carMesh.quaternion);
				carMesh.position.add(localOffset);
			}

			// Ajuste de rotação
			if (adjustments.rotation) {
				carMesh.rotateX(adjustments.rotation.x);
				carMesh.rotateY(adjustments.rotation.y);
				carMesh.rotateZ(adjustments.rotation.z);
			}
		}
	}

	/**
	 * Corrige o alinhamento de uma roda específica
	 */
	fixWheelAlignment(wheelIndex: number, wheelMesh: THREE.Object3D, wheelInfo: WheelInfo, adjustments: any): void {
		// Copiar a posição da roda calculada
		wheelMesh.position.copy(wheelInfo.worldPosition);

		// Copiar a rotação da roda
		wheelMesh.quaternion.copy(wheelInfo.worldQuaternion);

		// Espelhar as rodas do lado direito (índices ímpares)
		if (wheelIndex % 2 === 1) {
			wheelMesh.rotateY(Math.PI);
		}

		if (adjustments) {
			// Ajuste de rotação adicional
			if (adjustments.rotation) {
				wheelMesh.rotateX(adjustments.rotation.x);
				wheelMesh.rotateY(adjustments.rotation.y);
				wheelMesh.rotateZ(adjustments.rotation.z);
			}
		}
	}

	/**
	 * Limpa os recursos físicos do veículo atual
	 */
	private cleanupCurrentVehicle(): void {
		if (this.physicsPreStepCallback) {
			this.physicsManager.removePreStepCallback(this.physicsPreStepCallback);
			this.physicsPreStepCallback = null;
		}
		this.physics.destroy();
		this.wheelInfos = [];
	}

	/**
	 * Alterar o veículo atual
	 */
	changeVehicle(vehicleId: string): Promise<any> | boolean {
		if (!getVehicleDefinition(vehicleId)) {
			console.error(`Veículo ${vehicleId} não encontrado no catálogo`);
			return false;
		}

		// Limpar recursos físicos do veículo anterior
		this.cleanupCurrentVehicle();

		this.releaseObjects([this.mesh, ...this.wheelMeshes]);
		this.wheelMeshes = [];

		// Configurar novo veículo
		this.currentVehicleId = vehicleId;
		this.initVehicleConfigs();
		this.initPhysics();
		this.initVisuals();

		return this.loadVehicle(this.vehicleData);
	}

	/**
	 * Remove objetos da cena e libera geometrias e materiais na GPU
	 */
	private releaseObjects(objects: THREE.Object3D[]): void {
		for (const object of objects) {
			object.removeFromParent();
			object.traverse((child) => {
				if (child instanceof THREE.Mesh) {
					child.geometry.dispose();
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					materials.forEach((material) => material.dispose());
				}
			});
		}
	}

	resetCar(): void {
		this.physics.reset();
	}

	override getPosition(): THREE.Vector3 {
		return this.mesh.position;
	}

	getCameraConfig(): Record<CameraMode, CameraConfig> {
		return this.vehicleData.cameraSettings;
	}

	/**
	 * Velocidade ao longo da frente do chassi, em km/h (negativa em ré)
	 */
	getCurrentSpeed(): number {
		return this.physics.forwardSpeed() * 3.6;
	}

	/**
	 * Obter o ângulo atual do volante (graus)
	 */
	getWheelAngle(): number {
		return this.physics.wheelSteering(0) * (180 / Math.PI);
	}

	getMovimentDirection(): THREE.Vector3 {
		const chassisRot = this.physics.chassisBody.rotation();
		const direction = VehiclePhysics.LOCAL_FORWARD.clone();
		direction.applyQuaternion(new THREE.Quaternion(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w));
		return direction;
	}
}
