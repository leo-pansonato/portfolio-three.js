import * as THREE from "three";
import * as CANNON from "cannon-es";
import Entity from "./Entity";
import ModelLoader from "../loaders/ModelLoader";
import VehicleManager from "../managers/VehicleManager";
import InputManager from "../managers/InputManager";
import PhysicsManager from "../managers/PhysicsManager";

// Interface auxiliar para os dados do veículo
// (Reflete a estrutura que vem do VehicleManager)
interface VehicleData {
	physics: {
		mass: number;
		size: { x: number; y: number; z: number };
		wheelRadius: number;
		suspensionStiffness: number;
		suspensionRestLength: number;
		maxSuspensionTravel: number;
		dampingCompression: number;
		dampingRelaxation: number;
		rollInfluence: number;
		frictionSlip: number;
	};
	configs: {
		maxSteerVal: number;
		currentSteering: number;
		currentSpeed: number;
		steerSpeed: number;
		steerReturn: number;
		maxForce: number;
		maxBoostForce: number;
		boostForce: number;
		brakeForce: number;
		eBrakeForce: number;
		tractionDisplacement: string;
	};
	wheels: {
		adjustments: Array<{
			position: { x: number; y: number; z: number };
			rotation?: { x: number; y: number; z: number };
		}>;
	};
	body?: any; // Configurações visuais do corpo
}

/**
 * Player jogável usando RaycastVehicle do Cannon.js
 */
export default class Player extends Entity {
	private inputManager: InputManager;
	private physicsManager: PhysicsManager;
	private modelLoader: ModelLoader;
	private vehicleManager: VehicleManager;

	private currentVehicleId: string;
	private vehicleData!: VehicleData;

	public chassisBody!: CANNON.Body;
	public vehicle!: CANNON.RaycastVehicle;
	public declare mesh: THREE.Mesh | THREE.Object3D; // Sobrescreve a propriedade da classe pai Entity
	private originalMesh!: THREE.Object3D;
	private wheelMeshes: THREE.Object3D[];

	// Visualização de Debug (opcional)
	private suspensionRays: THREE.Line[];
	private showSuspensionRays: boolean;

	constructor(scene: THREE.Scene, inputManager: InputManager, physicsManager: PhysicsManager) {
		super(scene);
		this.inputManager = inputManager;
		this.physicsManager = physicsManager;
		this.modelLoader = new ModelLoader();
		this.vehicleManager = new VehicleManager(scene, physicsManager);

		// ID do veículo atual
		this.currentVehicleId = "bmw_f82"; // bmw_f82 / mercedes_g63

		this.wheelMeshes = [];
		this.suspensionRays = [];
		this.showSuspensionRays = false;

		// Inicializar a configuração do veículo
		this.initVehicleConfigs();

		// Inicializar o veículo físico
		this.initPhysics();

		// Inicializar o veículo visual
		this.initVisuals();

		// Adicionar veiculo à cena
		this.addToScene();

		// Carregar o modelo do veículo
		this.loadVehicle(this.currentVehicleId);

		// Inicializar a visualização dos raycasts de suspensão
		// this.initSuspensionRaycastVisualizer();
	}

	initVehicleConfigs(): void {
		// Acessando propriedade privada via cast any ou assumindo que vehicleManager expõe isso
		// Idealmente, VehicleManager deveria ter um método getVehicleConfig(id)
		this.vehicleData = (this.vehicleManager as any).vehicleCatalog[this.currentVehicleId];
	}

	/**
	 * Inicializar o veículo físico
	 */
	initPhysics(): void {
		// Criar o chassi do veículo
		const physicsData = this.vehicleData.physics;
		const chassisSize = physicsData.size;

		// Criar o corpo físico
		const chassisShape = new CANNON.Box(new CANNON.Vec3(chassisSize.x / 2, chassisSize.y / 2, chassisSize.z / 2));
		this.chassisBody = new CANNON.Body({ mass: physicsData.mass });
		this.chassisBody.addShape(chassisShape);
		this.chassisBody.position.set(0, 1, 3);
		this.chassisBody.angularVelocity.set(0, 0, 0);

		// Configurar e criar o veículo
		this.setupVehicle(this.vehicleData);
	}

	/**
	 * Configurar o veículo físico com as rodas
	 */
	setupVehicle(vehicleData: VehicleData): void {
		const physicsData = vehicleData.physics;
		// Criar o veículo raycast
		this.vehicle = new CANNON.RaycastVehicle({
			chassisBody: this.chassisBody,
		});

		// Opções das rodas
		const options = {
			radius: physicsData.wheelRadius,
			directionLocal: new CANNON.Vec3(0, -1, 0),
			chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
			axleLocal: new CANNON.Vec3(0, 0, 1),
			suspensionStiffness: physicsData.suspensionStiffness,
			suspensionRestLength: physicsData.suspensionRestLength,
			maxSuspensionTravel: physicsData.maxSuspensionTravel,
			dampingCompression: physicsData.dampingCompression,
			dampingRelaxation: physicsData.dampingRelaxation,
			rollInfluence: physicsData.rollInfluence,
			maxSuspensionForce: 100000,
			frictionSlip: physicsData.frictionSlip,
			customSlidingRotationalSpeed: 20,
			useCustomSlidingRotationalSpeed: true,
		};

		// Adicionar as rodas
		for (let i = 0; i < vehicleData.wheels.adjustments.length; i++) {
			options.chassisConnectionPointLocal.set(
				vehicleData.wheels.adjustments[i].position.x,
				vehicleData.wheels.adjustments[i].position.y,
				vehicleData.wheels.adjustments[i].position.z
			);
			this.vehicle.addWheel(options);
		}

		// Adicionar o veículo ao mundo físico
		this.vehicle.addToWorld(this.physicsManager.world);
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

		for (let i = 0; i < 4; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			this.scene.add(wheelMesh);
			this.wheelMeshes.push(wheelMesh);
		}

		// Guardar referência à mesh original
		this.originalMesh = this.mesh;

		// Adicionar o chassi ao gerenciador de física
		this.physicsManager.addBody(this.chassisBody, this.mesh);
	}

	/**
	 * Carregar um veículo específico
	 */
	async loadVehicle(vehicleId: string): Promise<any> {
		try {
			console.log(`Carregando veículo: ${vehicleId}`);

			// Carregar os novos modelos
			const vehicleModels = await this.vehicleManager.loadVehicle(vehicleId, this.vehicle);

			// Remover o modelo atual da cena
			this.scene.remove(this.mesh);

			// Remover as rodas atuais da cena
			this.wheelMeshes.forEach((wheel) => {
				if (wheel.parent) {
					this.scene.remove(wheel);
				}
			});

			// Atualizar a referência ao modelo do chassi
			if (vehicleModels.body) {
				this.mesh = vehicleModels.body;
				this.scene.add(this.mesh);
			}

			// Atualizar as referências às rodas
			if (vehicleModels.wheels) {
				// @ts-ignore: Pode vir Mesh[] ou Object3D[], compatíveis
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

		// Atualizar o modelo visual do chassi
		this.updateChassisMesh();

		// Atualizar os modelos visuais das rodas
		this.updateWheelMeshes();

		// Atualizar a visualização dos raycasts de suspensão
		// this.updateSuspensionRaycastVisualizer();
	}

	/**
	 * Atualizar a direção do veículo (volante)
	 */
	updateSteering(timeStep: number): void {
		// Determinar o valor alvo para a direção
		let targetSteering = 0;
		if (this.inputManager.isKeyPressed("arrowleft")) {
			targetSteering = this.vehicleData.configs.maxSteerVal;
		} else if (this.inputManager.isKeyPressed("arrowright")) {
			targetSteering = -this.vehicleData.configs.maxSteerVal;
		}

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

		// Aplicar a direção às rodas dianteiras
		this.vehicle.setSteeringValue(this.vehicleData.configs.currentSteering, 0);
		this.vehicle.setSteeringValue(this.vehicleData.configs.currentSteering, 1);
	}

	/**
	 * Atualizar aceleração, frenagem e tração do veículo
	 */
	updateDriving(timeStep: number): void {
		// Calcular a velocidade atual
		const velocity = this.vehicle.chassisBody.velocity;
		const chassisForward = new CANNON.Vec3();
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), chassisForward);
		this.vehicleData.configs.currentSpeed = velocity.dot(chassisForward);

		// Flag para marchas
		const isAlmostStopped = this.vehicleData.configs.currentSpeed > -2.0;

		// Inicializar forças
		let engineForce = 0;
		let brakeForce = 0;
		let handbrakeForce = 0;

		// Verificar inputs
		const accelerating = this.inputManager.isKeyPressed("arrowup");
		const braking = this.inputManager.isKeyPressed("arrowdown");
		const handbraking = this.inputManager.isKeyPressed(" ");
		const boosting = this.inputManager.isKeyPressed("shift");

		// Gerenciar boost
		if (boosting) {
			this.vehicleData.configs.boostForce = this.vehicleData.configs.maxBoostForce;
		} else {
			this.vehicleData.configs.boostForce = 1;
		}

		// Determinar força do motor
		if (accelerating) {
			engineForce = this.vehicleData.configs.maxForce;
		}

		// Gerenciar frenagem e marcha-ré
		if (braking) {
			if (isAlmostStopped && !accelerating) {
				// Marcha-ré
				engineForce = -this.vehicleData.configs.maxForce;
			} else {
				// Frenagem normal
				brakeForce = this.vehicleData.configs.brakeForce;
			}
		}

		// Freio de mão
		if (handbraking) {
			handbrakeForce = this.vehicleData.configs.eBrakeForce;
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
				this.vehicle.applyEngineForce(force, 2); // Traseira esquerda
				this.vehicle.applyEngineForce(force, 3); // Traseira direita
				break;
			case "front":
				// Tração dianteira
				this.vehicle.applyEngineForce(force, 0); // Frontal esquerda
				this.vehicle.applyEngineForce(force, 1); // Frontal direita
				break;
			case "all":
			default:
				// Tração integral
				this.vehicle.applyEngineForce(force, 0); // Frontal esquerda
				this.vehicle.applyEngineForce(force, 1); // Frontal direita
				this.vehicle.applyEngineForce(force, 2); // Traseira esquerda
				this.vehicle.applyEngineForce(force, 3); // Traseira direita
				break;
		}
	}

	/**
	 * Aplicar frenagem ao veículo
	 */
	applyBraking(normalBrake: number, handBrake: number): void {
		// Frear rodas dianteiras (com freio normal)
		this.vehicle.setBrake(normalBrake, 0); // Frontal esquerda
		this.vehicle.setBrake(normalBrake, 1); // Frontal direita

		// Frear rodas traseiras (com handbrake se ativado)
		const rearBrakeForce = handBrake > 0 ? handBrake : normalBrake;
		this.vehicle.setBrake(rearBrakeForce, 2); // Traseira esquerda
		this.vehicle.setBrake(rearBrakeForce, 3); // Traseira direita
	}

	/**
	 * Atualizar o modelo visual do chassi
	 */
	updateChassisMesh(): void {
		if (this.mesh && this.mesh !== this.originalMesh) {
			// Obter a configuração de alinhamento do veículo atual
			const chassisTransform = this.chassisBody;
			const chassisAdjustment = this.vehicleData?.body || null;

			// Aplicar a transformação e ajustes à mesh do chassi
			this.fixCarAlignment(this.mesh, chassisTransform, chassisAdjustment);
		}
	}

	/**
	 * Atualizar os modelos visuais das rodas
	 */
	updateWheelMeshes(): void {
		for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
			// Atualizar transformação física da roda
			this.vehicle.updateWheelTransform(i);
			const wheelTransform = this.vehicle.wheelInfos[i].worldTransform;

			const wheelAdjustment = this.vehicleData?.wheels?.adjustments?.[i] || null;

			// Aplicar a transformação e ajustes à mesh da roda
			this.fixWheelAlignment(i, this.wheelMeshes[i], wheelTransform, wheelAdjustment);
		}
	}

	/**
	 * Fixa o alinhamento do chassi
	 */
	fixCarAlignment(carMesh: THREE.Object3D, chassisTransform: CANNON.Body, adjustments: any): void {
		// Copiar a posição e rotação do corpo físico
		carMesh.position.set(chassisTransform.position.x, chassisTransform.position.y, chassisTransform.position.z);
		carMesh.quaternion.set(
			chassisTransform.quaternion.x,
			chassisTransform.quaternion.y,
			chassisTransform.quaternion.z,
			chassisTransform.quaternion.w
		);

		if (adjustments) {
			// Ajuste de posição
			if (adjustments.position) {
				const localOffset = new THREE.Vector3(adjustments.position.x, adjustments.position.y, adjustments.position.z);
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
	fixWheelAlignment(wheelIndex: number, wheelMesh: THREE.Object3D, wheelTransform: CANNON.Transform, adjustments: any): void {
		// Resetar rotações da roda para aplicar na ordem correta
		// wheelMesh.rotation.set(0, 0, 0);

		// Copiar a posição do corpo físico
		wheelMesh.position.set(wheelTransform.position.x, wheelTransform.position.y, wheelTransform.position.z);

		// Copiar a rotação do corpo físico
		wheelMesh.quaternion.set(
			wheelTransform.quaternion.x,
			wheelTransform.quaternion.y,
			wheelTransform.quaternion.z,
			wheelTransform.quaternion.w
		);

		// Espelhar as rodas do lado direito (impares)
		if (wheelIndex % 2 === 1) {
			// wheelMesh.rotateY(Math.PI);
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
	 * Inicializa a visualização dos raycasts de suspensão
	 */
	initSuspensionRaycastVisualizer(): void {
		// Criar linhas para representar os raycasts
		this.suspensionRays = [];
		const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

		for (let i = 0; i < 4; i++) {
			// Criar geometria de linha (será atualizada a cada frame)
			const geometry = new THREE.BufferGeometry();
			const positions = new Float32Array(2 * 3); // 2 pontos, 3 coordenadas por ponto
			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

			// Criar a linha e adicionar à cena
			const line = new THREE.Line(geometry, material);
			this.scene.add(line);
			this.suspensionRays.push(line);
		}

		// Flag para controlar a visualização
		this.showSuspensionRays = true;
	}

	/**
	 * Atualiza a visualização dos raycasts de suspensão
	 */
	updateSuspensionRaycastVisualizer(): void {
		// Se a visualização estiver desativada, sair da função
		if (!this.showSuspensionRays) return;

		// Atualizar cada linha de raycast
		for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
			const wheelInfo = this.vehicle.wheelInfos[i];
			const ray = this.suspensionRays[i];

			// Obter o ponto de conexão da roda no espaço mundial
			const connectionPoint = new CANNON.Vec3();
			this.vehicle.chassisBody.pointToWorldFrame(wheelInfo.chassisConnectionPointLocal, connectionPoint);

			// Calcular a direção do raycast no espaço mundial
			const direction = new CANNON.Vec3();
			this.vehicle.chassisBody.vectorToWorldFrame(wheelInfo.directionLocal, direction);

			// Normalizar e escalar a direção pelo comprimento máximo da suspensão
			direction.normalize();
			const maxLength = wheelInfo.suspensionRestLength + wheelInfo.maxSuspensionTravel;
			direction.scale(maxLength, direction);

			// Calcular o ponto final do raycast
			const endPoint = new CANNON.Vec3();
			endPoint.copy(connectionPoint);
			endPoint.vadd(direction, endPoint);

			// Atualizar a geometria da linha
			const positions = ray.geometry.attributes.position.array as Float32Array;

			// Ponto inicial (conexão com o chassi)
			positions[0] = connectionPoint.x;
			positions[1] = connectionPoint.y;
			positions[2] = connectionPoint.z;

			// Ponto final (comprimento total do raycast)
			positions[3] = endPoint.x;
			positions[4] = endPoint.y;
			positions[5] = endPoint.z;

			// Marcar a geometria para atualização
			ray.geometry.attributes.position.needsUpdate = true;
		}
	}

	/**
	 * Alterar o veículo atual
	 */
	changeVehicle(vehicleId: string): Promise<any> | boolean {
		if (!(this.vehicleManager as any).vehicleCatalog[vehicleId]) {
			console.error(`Veículo ${vehicleId} não encontrado no catálogo`);
			return false;
		}

		this.vehicle.removeFromWorld(this.physicsManager.world);
		this.removeFromScene();
		this.wheelMeshes.forEach((wheel) => {
			if (wheel.parent) {
				this.scene.remove(wheel);
			}
		});

		this.currentVehicleId = vehicleId;
		this.initVehicleConfigs();
		this.initPhysics();

		return this.loadVehicle(vehicleId);
	}

	override getPosition(): THREE.Vector3 {
		return this.mesh.position;
	}

	override getRotation(): THREE.Euler {
		return this.mesh.rotation;
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
		return this.vehicle.wheelInfos[0].steering * (180 / Math.PI);
	}

	getMovimentDirection(): CANNON.Vec3 {
		const direction = new CANNON.Vec3(0, 0, 0);
		this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), direction);
		return direction;
	}
}
