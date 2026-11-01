import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import InputManager from "../managers/InputManager";
import PhysicsManager from "../managers/PhysicsManager";
import VehicleManager, { CameraConfig, CameraMode, VehicleConfig } from "../managers/VehicleManager";
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
}

/**
 * Player jogável usando DynamicRayCastVehicleController do Rapier
 */
export default class Player extends Entity {
	private inputManager: InputManager;
	private physicsManager: PhysicsManager;
	private vehicleManager: VehicleManager;

	private currentVehicleId: string;
	private vehicleData!: VehicleConfig;

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
	private loadRequestId = 0;
	private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);
	private static readonly AXIS_Z = new THREE.Vector3(0, 0, 1);
	private static readonly LOCAL_FORWARD = new THREE.Vector3(-1, 0, 0);

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
		this.loadVehicle(this.currentVehicleId);
	}

	initVehicleConfigs(): void {
		const vehicleConfig = this.vehicleManager.getVehicleConfig(this.currentVehicleId);
		if (!vehicleConfig) throw new Error(`Configuração do veículo ${this.currentVehicleId} não encontrada.`);

		this.vehicleData = vehicleConfig;
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
	setupVehicleController(vehicleData: VehicleConfig): void {
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

			// Direção da suspensão (para baixo)
			const suspensionDirection = new THREE.Vector3(0, -1, 0);

			// Eixo da roda (lateral) - no Rapier, a roda gira em torno deste eixo
			const axle = new THREE.Vector3(0, 0, 1);

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

		// Criar novo callback que atualiza o vehicle controller
		this.physicsPreStepCallback = (dt: number) => {
			if (this.vehicleController) {
				this.vehicleController.updateVehicle(dt);
			}
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
		const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.15, 32);
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
	async loadVehicle(vehicleId: string): Promise<any> {
		try {
			const requestId = ++this.loadRequestId;
			const vehicleModels = await this.vehicleManager.loadVehicle(vehicleId, this.WHEEL_COUNT);

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

			// Atualizar o ID atual
			this.currentVehicleId = vehicleId;
		} catch (error) {
			console.error(`Erro ao carregar veículo ${vehicleId}:`, error);
		}
	}

	/**
	 * Atualizar a física e a visualização do veículo
	 */
	update(deltaTime: number): void {
		// Limitar o delta time para evitar problemas com FPS baixo
		const timeStep = Math.min(deltaTime, 1 / 30);

		// Atualizar a direção (volante)
		this.updateSteering(timeStep);

		// Atualizar aceleração e frenagem
		this.updateDriving(timeStep);

		// NOTA: O vehicleController.updateVehicle() é chamado no callback de física
		// registrado em registerPhysicsCallback(), usando o timestep fixo

		// Atualizar informações das rodas
		this.updateWheelInfos();

		// Atualizar o modelo visual do chassi
		this.updateChassisMesh();

		// Atualizar os modelos visuais das rodas
		this.updateWheelMeshes();
	}

	/**
	 * Atualiza as informações das rodas do controlador Rapier
	 */
	private updateWheelInfos(): void {
		for (let i = 0; i < this.wheelInfos.length; i++) {
			const wheelInfo = this.wheelInfos[i];

			// Obter informações do controlador de veículo do Rapier
			const isInContact = this.vehicleController.wheelIsInContact(i);
			const suspensionLength = this.vehicleController.wheelSuspensionLength(i);
			const steering = this.vehicleController.wheelSteering(i);
			const rotation = this.vehicleController.wheelRotation(i);

			// Atualizar informações
			wheelInfo.isInContact = isInContact ?? false;
			wheelInfo.suspensionLength = suspensionLength ?? wheelInfo.suspensionRestLength;
			wheelInfo.steering = steering ?? 0;
			wheelInfo.rotation = rotation ?? 0;

			// Calcular posição e rotação da roda no mundo
			this.calculateWheelWorldTransform(wheelInfo);
		}
	}

	/**
	 * Calcula a transformação mundial da roda
	 */
	private calculateWheelWorldTransform(wheelInfo: WheelInfo): void {
		// Obter transformação do chassi
		const chassisPos = this.chassisRigidBody.translation();
		const chassisRot = this.chassisRigidBody.rotation();

		this.tempQuaternion.set(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w);

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
	 * Atualizar a direção do veículo (volante)
	 */
	updateSteering(timeStep: number): void {
		// Determinar o valor alvo para a direção usando valores analógicos
		// getSteer() retorna -1 (esquerda) a +1 (direita)
		const steerInput = this.inputManager.getSteer() * -1;
		const targetSteering = steerInput * this.vehicleData.configs.maxSteerVal;

		// Ajustar a resposta da direção com base na velocidade
		const speedFactor = Math.min(Math.abs(this.vehicleData.configs.currentSpeed) / 100, 1);
		const effectiveSteerSpeed = this.vehicleData.configs.steerSpeed * (1 - speedFactor * 0.5);
		const effectiveReturnSpeed = this.vehicleData.configs.steerReturn * (1 + speedFactor * 0.5);

		// Movimento gradual do volante
		if (targetSteering !== 0) {
			// Movimento em direção ao valor alvo
			if (this.vehicleData.configs.currentSteering < targetSteering) {
				this.vehicleData.configs.currentSteering += effectiveSteerSpeed * timeStep;
				if (this.vehicleData.configs.currentSteering > targetSteering) {
					this.vehicleData.configs.currentSteering = targetSteering;
				}
			} else if (this.vehicleData.configs.currentSteering > targetSteering) {
				this.vehicleData.configs.currentSteering -= effectiveSteerSpeed * timeStep;
				if (this.vehicleData.configs.currentSteering < targetSteering) {
					this.vehicleData.configs.currentSteering = targetSteering;
				}
			}
		} else {
			// Retorno automático para centro
			if (Math.abs(this.vehicleData.configs.currentSteering) < effectiveReturnSpeed * timeStep) {
				this.vehicleData.configs.currentSteering = 0;
			} else if (this.vehicleData.configs.currentSteering > 0) {
				this.vehicleData.configs.currentSteering -= effectiveReturnSpeed * timeStep;
			} else if (this.vehicleData.configs.currentSteering < 0) {
				this.vehicleData.configs.currentSteering += effectiveReturnSpeed * timeStep;
			}
		}

		// Aplicar a direção às rodas dianteiras usando o controlador do Rapier
		this.vehicleController.setWheelSteering(0, this.vehicleData.configs.currentSteering);
		this.vehicleController.setWheelSteering(1, this.vehicleData.configs.currentSteering);
	}

	/**
	 * Atualizar aceleração, frenagem e tração do veículo
	 */
	updateDriving(_timeStep: number): void {
		// Calcular a velocidade atual usando o Rapier
		const velocity = this.chassisRigidBody.linvel();
		const chassisRot = this.chassisRigidBody.rotation();

		// Vetor forward do chassi
		this.tempQuaternion.set(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w);
		const forward = this.tempVector3.copy(Player.LOCAL_FORWARD).applyQuaternion(this.tempQuaternion);

		// Velocidade na direção do movimento
		this.vehicleData.configs.currentSpeed = velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;

		// Flag para marchas
		const isAlmostStopped = this.vehicleData.configs.currentSpeed > -2.0;

		// Inicializar forças
		let engineForce = 0;
		let brakeForce = 0;
		let handbrakeForce = 0;

		// Obter valores analógicos (0 a 1) - funciona com gamepad e teclado
		const throttleValue = this.inputManager.getThrottle();
		const brakeValue = this.inputManager.getBrake();
		const handbraking = this.inputManager.isActionActive("VEHICLE_HANDBRAKE");
		const boosting = this.inputManager.isActionActive("VEHICLE_BOOST");

		// Gerenciar boost
		if (boosting) {
			this.vehicleData.configs.boostForce = this.vehicleData.configs.maxBoostForce;
		} else {
			this.vehicleData.configs.boostForce = 1;
		}

		// Determinar força do motor (proporcional ao input analógico)
		if (throttleValue > 0) {
			engineForce = this.vehicleData.configs.maxForce * throttleValue;
		}

		// Gerenciar frenagem e marcha-ré
		if (brakeValue > 0) {
			if (isAlmostStopped && throttleValue === 0) {
				// Marcha-ré (proporcional ao input)
				engineForce = -this.vehicleData.configs.maxForce * brakeValue;
			} else {
				// Frenagem normal (proporcional ao input)
				brakeForce = this.vehicleData.configs.brakeForce * brakeValue;
			}
		}

		// Freio de mão
		if (handbraking) {
			handbrakeForce = this.vehicleData.configs.eBrakeForce;
		}

		// o controlador do Rapier não tem resistência ao rolamento
		if (throttleValue === 0 && brakeValue === 0) {
			brakeForce = this.vehicleData.configs.rollingResistance;
		}

		// Aplicar boost
		engineForce *= this.vehicleData.configs.boostForce;

		// Aplicar força do motor conforme configuração de tração
		this.applyEngineForce(engineForce);

		// Aplicar frenagem
		this.applyBraking(brakeForce, handbrakeForce);
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
	 * Aplicar frenagem ao veículo
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
			// Obter a transformação do chassi do Rapier
			const chassisPos = this.chassisRigidBody.translation();
			const chassisRot = this.chassisRigidBody.rotation();
			const chassisAdjustment = this.vehicleData?.body || null;

			// Aplicar a transformação e ajustes à mesh do chassi
			this.fixCarAlignment(this.mesh, chassisPos, chassisRot, chassisAdjustment);
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
		if (!(this.vehicleManager as any).vehicleCatalog[vehicleId]) {
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

		return this.loadVehicle(vehicleId);
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
		}
	}

	override getPosition(): THREE.Vector3 {
		return this.mesh.position;
	}

	getCameraConfig(): Record<CameraMode, CameraConfig> {
		return this.vehicleData.cameraSettings;
	}

	/**
	 * Obter a velocidade atual do veículo
	 */
	getCurrentSpeed(): number {
		return this.vehicleData.configs.currentSpeed * 3.6 * -1;
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
		const direction = new THREE.Vector3(-1, 0, 0);
		direction.applyQuaternion(new THREE.Quaternion(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w));
		return direction;
	}
}
