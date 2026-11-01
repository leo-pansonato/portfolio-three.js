import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import InputManager from "../managers/InputManager";
import PhysicsManager from "../managers/PhysicsManager";
import { CameraConfig, CameraMode, getVehicleDefinition, VehicleDefinition } from "../data/vehicles";
import VehicleManager from "../managers/VehicleManager";
import VehicleControl, { createDriverInput } from "../vehicle/VehicleControl";
import { createVehicleState, VehicleState } from "../vehicle/VehicleState";
import Entity from "./Entity";

/**
 * Informações de cada roda para o sistema de veículos
 */
interface WheelInfo {
	/** Posição local da conexão da suspensão no chassi */
	connectionPoint: THREE.Vector3;
	/** Direção da suspensão (normalmente para baixo) */
	suspensionDirection: THREE.Vector3;
	/** Eixo de rotação da roda */
	axle: THREE.Vector3;
	/** Raio da roda */
	radius: number;
	/** Comprimento de descanso da suspensão */
	suspensionRestLength: number;
	/** Posição atual da roda no mundo */
	worldPosition: THREE.Vector3;
	/** Rotação atual da roda no mundo */
	worldQuaternion: THREE.Quaternion;
	/** Ângulo de direção atual */
	steering: number;
	/** Rotação atual da roda (spin) */
	rotation: number;
	/** Se a roda está no chão */
	isInContact: boolean;
	/** Distância do raycast até o solo */
	suspensionLength: number;
	/** Valores do passo anterior, para interpolação visual */
	previousSuspensionLength: number;
	previousSteering: number;
	previousRotation: number;
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

	// Física Rapier
	public chassisRigidBody!: RAPIER.RigidBody;
	public chassisCollider!: RAPIER.Collider;
	public vehicleController!: RAPIER.DynamicRayCastVehicleController;

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
	/** Eixos locais do chassi (ADR-0002): frente +X, cima +Y, direita +Z */
	private static readonly LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
	private static readonly LOCAL_DOWN = new THREE.Vector3(0, -1, 0);
	private static readonly LOCAL_RIGHT = new THREE.Vector3(0, 0, 1);

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
	 * Inicializar o veículo físico com Rapier
	 */
	initPhysics(): void {
		const physicsData = this.vehicleData.physics;
		const chassisSize = physicsData.size;

		// Criar o RigidBody do chassi (dinâmico)
		this.chassisRigidBody = this.physicsManager.createRigidBody({
			type: "dynamic",
			position: { x: 0, y: 1, z: 3 },
			linearDamping: 0.01,
			angularDamping: 0.01,
			canSleep: false,
			ccdEnabled: true, // Continuous collision detection para movimento rápido
		});

		// Criar o Collider do chassi (separado do RigidBody no Rapier)
		this.chassisCollider = this.physicsManager.createCollider(
			{
				shape: "cuboid",
				halfExtents: {
					x: chassisSize.x / 2,
					y: chassisSize.y / 2,
					z: chassisSize.z / 2,
				},
				friction: 0.5,
				restitution: 0.1,
				density: physicsData.mass / (chassisSize.x * chassisSize.y * chassisSize.z),
			},
			this.chassisRigidBody
		);

		// Configurar e criar o controlador de veículo
		this.setupVehicleController(this.vehicleData);
	}

	/**
	 * Configurar o DynamicRayCastVehicleController do Rapier
	 */
	setupVehicleController(vehicleData: VehicleDefinition): void {
		const physicsData = vehicleData.physics;
		const RAPIER = this.physicsManager.getRapier();

		// Criar o controlador de veículo raycast
		this.vehicleController = this.physicsManager.world.createVehicleController(this.chassisRigidBody);

		// Configurar as rodas
		this.wheelInfos = [];

		for (let i = 0; i < vehicleData.wheels.adjustments.length; i++) {
			const wheelAdjustment = vehicleData.wheels.adjustments[i];

			// Posição de conexão da roda no chassi (coordenadas locais)
			const connectionPoint = new THREE.Vector3(
				wheelAdjustment.position.x,
				wheelAdjustment.position.y,
				wheelAdjustment.position.z
			);

			// o controlador usa +X como frente (indexForwardAxis = 0) e +Y como cima
			const suspensionDirection = Player.LOCAL_DOWN;
			const axle = Player.LOCAL_RIGHT;

			// Adicionar a roda ao controlador do veículo
			this.vehicleController.addWheel(
				// Posição de conexão (local ao chassi)
				new RAPIER.Vector3(connectionPoint.x, connectionPoint.y, connectionPoint.z),
				// Direção da suspensão (para baixo, local)
				new RAPIER.Vector3(suspensionDirection.x, suspensionDirection.y, suspensionDirection.z),
				// Eixo da roda (lateral, local)
				new RAPIER.Vector3(axle.x, axle.y, axle.z),
				// Comprimento de descanso da suspensão
				physicsData.suspensionRestLength,
				// Raio da roda
				physicsData.wheelRadius
			);

			// Configurar propriedades da suspensão para esta roda (Rapier)
			this.vehicleController.setWheelSuspensionStiffness(i, physicsData.suspensionStiffness);
			this.vehicleController.setWheelMaxSuspensionTravel(i, physicsData.maxSuspensionTravel);
			this.vehicleController.setWheelMaxSuspensionForce(i, physicsData.maxSuspensionForce);
			this.vehicleController.setWheelSuspensionCompression(i, physicsData.suspensionCompression);
			this.vehicleController.setWheelSuspensionRelaxation(i, physicsData.suspensionRelaxation);
			this.vehicleController.setWheelFrictionSlip(i, wheelAdjustment.frictionSlip ?? physicsData.frictionSlip);
			this.vehicleController.setWheelSideFrictionStiffness(i,  wheelAdjustment.sideFrictionStiffness ?? physicsData.sideFrictionStiffness);

			// Criar informações da roda para tracking
			this.wheelInfos.push({
				connectionPoint: connectionPoint.clone(),
				suspensionDirection: suspensionDirection.clone(),
				axle: axle.clone(),
				radius: physicsData.wheelRadius,
				suspensionRestLength: physicsData.suspensionRestLength,
				worldPosition: new THREE.Vector3(),
				worldQuaternion: new THREE.Quaternion(),
				steering: 0,
				rotation: 0,
				isInContact: false,
				suspensionLength: physicsData.suspensionRestLength,
				previousSuspensionLength: physicsData.suspensionRestLength,
				previousSteering: 0,
				previousRotation: 0,
			});
		}

		// Registrar callback para atualizar o vehicle controller no timestep fixo da física
		this.registerPhysicsCallback();
	}

	/**
	 * Registra o callback de física para atualizar o vehicle controller
	 */
	private registerPhysicsCallback(): void {
		// Remover callback anterior se existir
		if (this.physicsPreStepCallback) {
			this.physicsManager.removePreStepCallback(this.physicsPreStepCallback);
		}

		// controle por passo: input mais recente → volante e forças → controlador
		this.physicsPreStepCallback = (dt: number) => {
			this.savePreviousWheelStates();
			this.updateControl(dt);
			this.vehicleController.updateVehicle(dt);
		};

		// Registrar no physics manager
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
		this.physicsManager.addEntity(this.chassisRigidBody, this.mesh);
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

		const commands = this.control.step(input, this.forwardSpeed(), dt);
		this.vehicleController.setWheelSteering(0, commands.steeringAngle);
		this.vehicleController.setWheelSteering(1, commands.steeringAngle);
		this.applyEngineForce(commands.engineForce);
		// o controlador recebe o freio como impulso máximo por passo (N·s)
		this.applyBraking(commands.brakeForce * dt, commands.handbrakeForce * dt);
	}

	/**
	 * Atualizar a visualização do veículo (por quadro; o controle roda em updateControl)
	 */
	update(_deltaTime: number): void {
		this.physicsManager.getInterpolatedPose(this.chassisRigidBody, this.renderPosition, this.renderQuaternion);

		// Atualizar informações das rodas
		this.updateWheelInfos(this.physicsManager.getInterpolationAlpha());

		// Atualizar o modelo visual do chassi
		this.updateChassisMesh();

		// Atualizar os modelos visuais das rodas
		this.updateWheelMeshes();
	}

	private savePreviousWheelStates(): void {
		for (let i = 0; i < this.wheelInfos.length; i++) {
			const wheelInfo = this.wheelInfos[i];
			wheelInfo.previousSuspensionLength = this.vehicleController.wheelSuspensionLength(i) ?? wheelInfo.suspensionRestLength;
			wheelInfo.previousSteering = this.vehicleController.wheelSteering(i) ?? 0;
			wheelInfo.previousRotation = this.vehicleController.wheelRotation(i) ?? 0;
		}
	}

	/**
	 * Atualiza as informações das rodas do controlador Rapier, interpoladas por alpha (0–1)
	 */
	private updateWheelInfos(alpha: number): void {
		for (let i = 0; i < this.wheelInfos.length; i++) {
			const wheelInfo = this.wheelInfos[i];

			// Obter informações do controlador de veículo do Rapier
			const isInContact = this.vehicleController.wheelIsInContact(i);
			const suspensionLength = this.vehicleController.wheelSuspensionLength(i);
			const steering = this.vehicleController.wheelSteering(i);
			const rotation = this.vehicleController.wheelRotation(i);

			// Atualizar informações
			wheelInfo.isInContact = isInContact ?? false;
			wheelInfo.suspensionLength = THREE.MathUtils.lerp(wheelInfo.previousSuspensionLength, suspensionLength ?? wheelInfo.suspensionRestLength, alpha);
			wheelInfo.steering = THREE.MathUtils.lerp(wheelInfo.previousSteering, steering ?? 0, alpha);
			wheelInfo.rotation = THREE.MathUtils.lerp(wheelInfo.previousRotation, rotation ?? 0, alpha);

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
	 * Aplicar a força do motor com base no tipo de tração
	 */
	applyEngineForce(force: number): void {
		switch (this.vehicleData.configs.tractionDisplacement) {
			case "rear":
				// Tração traseira
				this.vehicleController.setWheelEngineForce(2, force); // Traseira esquerda
				this.vehicleController.setWheelEngineForce(3, force); // Traseira direita
				// Zerar as rodas dianteiras
				this.vehicleController.setWheelEngineForce(0, 0);
				this.vehicleController.setWheelEngineForce(1, 0);
				break;
			case "front":
				// Tração dianteira
				this.vehicleController.setWheelEngineForce(0, force); // Frontal esquerda
				this.vehicleController.setWheelEngineForce(1, force); // Frontal direita
				// Zerar as rodas traseiras
				this.vehicleController.setWheelEngineForce(2, 0);
				this.vehicleController.setWheelEngineForce(3, 0);
				break;
			case "all":
			default:
				// Tração integral
				this.vehicleController.setWheelEngineForce(0, force); // Frontal esquerda
				this.vehicleController.setWheelEngineForce(1, force); // Frontal direita
				this.vehicleController.setWheelEngineForce(2, force); // Traseira esquerda
				this.vehicleController.setWheelEngineForce(3, force); // Traseira direita
				break;
		}
	}

	/**
	 * Aplicar frenagem ao veículo (impulsos por passo, N·s por roda)
	 */
	applyBraking(normalBrake: number, handBrake: number): void {
		// Freio nas rodas traseiras (com handbrake se ativado)
		const rearBrakeForce = handBrake > 0 ? handBrake : normalBrake;
		this.vehicleController.setWheelBrake(2, rearBrakeForce); // Traseira esquerda
		this.vehicleController.setWheelBrake(3, rearBrakeForce); // Traseira direita

		// Freio nas rodas dianteiras (apenas freio normal)
		this.vehicleController.setWheelBrake(0, normalBrake);
		this.vehicleController.setWheelBrake(1, normalBrake);
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
		// Remover callback de física
		if (this.physicsPreStepCallback) {
			this.physicsManager.removePreStepCallback(this.physicsPreStepCallback);
			this.physicsPreStepCallback = null;
		}

		// Remover o RigidBody do chassi (isso também remove os colliders associados)
		if (this.vehicleController) {
			this.physicsManager.world.removeVehicleController(this.vehicleController);
		}

		if (this.chassisRigidBody) {
			this.physicsManager.removeEntity(this.chassisRigidBody);
		}

		// Limpar referências
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
		if (this.chassisRigidBody) {
			// Obter posição atual
			const currentPos = this.chassisRigidBody.translation();

			// Resetar posição (elevar um pouco)
			this.chassisRigidBody.setTranslation(
				{ x: currentPos.x, y: currentPos.y + 1, z: currentPos.z },
				true
			);

			// Resetar rotação para upright
			this.chassisRigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

			// Resetar velocidades
			this.chassisRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			this.chassisRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

			this.physicsManager.resetInterpolation(this.chassisRigidBody);
		}
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
		return this.forwardSpeed() * 3.6;
	}

	/** Velocidade do chassi ao longo de +X local (m/s; negativa em ré) */
	private forwardSpeed(): number {
		const velocity = this.chassisRigidBody.linvel();
		const chassisRot = this.chassisRigidBody.rotation();
		this.tempQuaternion.set(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w);
		const forward = this.tempVector3.copy(Player.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);
		return velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
	}

	/**
	 * Obter o ângulo atual do volante
	 */
	getWheelAngle(): number {
		const steering = this.vehicleController.wheelSteering(0);
		return (steering ?? 0) * (180 / Math.PI);
	}

	getMovimentDirection(): THREE.Vector3 {
		const chassisRot = this.chassisRigidBody.rotation();
		const direction = Player.LOCAL_FORWARD.clone();
		direction.applyQuaternion(new THREE.Quaternion(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w));
		return direction;
	}
}
