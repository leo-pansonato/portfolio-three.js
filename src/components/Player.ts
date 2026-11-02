import * as THREE from "three";
import InputManager from "../managers/InputManager";
import PhysicsManager from "../physics/PhysicsManager";
import { CameraConfig, CameraMode, getVehicleDefinition, VehicleDefinition } from "../data/vehicles";
import VehicleView from "../render/VehicleView";
import VehicleControl, { createDriverInput } from "../vehicle/VehicleControl";
import VehiclePhysics from "../vehicle/VehiclePhysics";
import { createVehicleState, VehicleState } from "../vehicle/VehicleState";
import Entity from "./Entity";

/**
 * Veículo do jogador: liga input, controle (VehicleControl), física (VehiclePhysics) e visual (VehicleView)
 */
export default class Player extends Entity {
	private inputManager: InputManager;
	private physicsManager: PhysicsManager;

	private currentVehicleId: string;
	private vehicleData!: VehicleDefinition;
	private state!: VehicleState;
	private control!: VehicleControl;
	private readonly driverInput = createDriverInput();

	public physics!: VehiclePhysics;
	private readonly view: VehicleView;

	public declare mesh: THREE.Object3D;

	// Callback para atualização do veículo no step da física
	private physicsPreStepCallback: ((dt: number) => void) | null = null;

	constructor(scene: THREE.Scene, inputManager: InputManager, physicsManager: PhysicsManager) {
		super(scene);
		this.inputManager = inputManager;
		this.physicsManager = physicsManager;
		this.view = new VehicleView(scene, physicsManager);

		this.currentVehicleId = "bmw_f82"; // bmw_f82 / mercedes_g63
		this.initVehicle();
		this.addToScene();
		this.loadVehicle();
	}

	/**
	 * Cria definição, estado, controle, física e placeholders visuais do veículo atual
	 */
	private initVehicle(): void {
		const definition = getVehicleDefinition(this.currentVehicleId);
		if (!definition) throw new Error(`Configuração do veículo ${this.currentVehicleId} não encontrada.`);

		this.vehicleData = definition;
		this.state = createVehicleState();
		this.control = new VehicleControl(definition.configs, this.state);
		this.physics = new VehiclePhysics(this.physicsManager, definition);

		// controle por passo: input mais recente → volante e forças → controlador
		this.physicsPreStepCallback = (dt: number) => {
			this.physics.savePreviousWheelStates();
			this.updateControl(dt);
			this.physics.updateVehicle(dt);
		};
		this.physicsManager.addPreStepCallback(this.physicsPreStepCallback);

		this.view.setVehicle(definition, this.physics);
		this.mesh = this.view.mesh;
	}

	private async loadVehicle(): Promise<void> {
		await this.view.load();
		this.mesh = this.view.mesh;
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
		this.view.update();
	}

	/**
	 * Remove o controle do pré-passo e os objetos do veículo atual do mundo físico
	 */
	private cleanupCurrentVehicle(): void {
		if (this.physicsPreStepCallback) {
			this.physicsManager.removePreStepCallback(this.physicsPreStepCallback);
			this.physicsPreStepCallback = null;
		}
		this.physics.destroy();
	}

	/**
	 * Alterar o veículo atual
	 */
	changeVehicle(vehicleId: string): Promise<void> | boolean {
		if (!getVehicleDefinition(vehicleId)) {
			console.error(`Veículo ${vehicleId} não encontrado no catálogo`);
			return false;
		}

		this.cleanupCurrentVehicle();
		this.currentVehicleId = vehicleId;
		this.initVehicle();

		return this.loadVehicle();
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
