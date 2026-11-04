import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { CameraConfig, CameraMode, getVehicleDefinition, VehicleDefinition } from "../data/vehicles";
import { InputFrame } from "../input/InputFrame";
import { Replay, ReplayInitialState } from "../replay/Replay";
import ReplayPlayback from "../replay/ReplayPlayback";
import ReplayRecorder from "../replay/ReplayRecorder";
import VehicleView from "../render/VehicleView";
import VehicleControl from "../vehicle/VehicleControl";
import VehiclePhysics from "../vehicle/VehiclePhysics";
import { createVehicleState, VehicleState } from "../vehicle/VehicleState";
import { VehicleTelemetry } from "../vehicle/VehicleTelemetry";
import Entity from "./Entity";

/**
 * Veículo do jogador: liga input, controle (VehicleControl), física (VehiclePhysics) e visual (VehicleView)
 */
export default class Player extends Entity {
	private readonly input: Readonly<InputFrame>;
	private physicsManager: PhysicsWorld;

	private currentVehicleId: string;
	private vehicleData!: VehicleDefinition;
	private state!: VehicleState;
	private control!: VehicleControl;

	public physics!: VehiclePhysics;
	private readonly view: VehicleView;

	declare public mesh: THREE.Object3D;

	private recorder: ReplayRecorder | null = null;
	private playback: ReplayPlayback | null = null;

	// Callback para atualização do veículo no step da física
	private physicsPreStepCallback: ((dt: number) => void) | null = null;

	constructor(scene: THREE.Scene, input: Readonly<InputFrame>, physicsManager: PhysicsWorld) {
		super(scene);
		this.input = input;
		this.physicsManager = physicsManager;
		this.view = new VehicleView(scene, physicsManager);

		this.currentVehicleId = "bmw_f82"; // bmw_f82 / mercedes_g63
		this.initVehicle();
		this.addToScene();
		void this.loadVehicle();
	}

	/**
	 * Cria definição, estado, controle, física e placeholders visuais do veículo atual
	 */
	private initVehicle(): void {
		const definition = getVehicleDefinition(this.currentVehicleId);
		if (!definition) throw new Error(`Configuração do veículo ${this.currentVehicleId} não encontrada.`);

		this.vehicleData = definition;
		this.state = createVehicleState(definition.powertrain.idleRpm);
		this.control = new VehicleControl(definition, this.state);
		this.physics = new VehiclePhysics(this.physicsManager, definition);

		// controle por passo: InputFrame do quadro → volante e forças → controlador
		this.physicsPreStepCallback = (dt: number) => {
			this.physics.updateTelemetry(dt, this.state);
			this.physics.savePreviousWheelStates();
			const input = this.nextStepInput();
			this.recorder?.record(input);
			this.updateControl(input, dt);
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
	private updateControl(input: Readonly<InputFrame>, dt: number): void {
		const physics = this.physics;
		const commands = this.control.step(
			input,
			physics.forwardSpeed(),
			dt,
			physics.drivenWheelSpeed(),
			physics.engineRpm(),
		);
		this.physics.applyCommands(commands, dt);
	}

	private nextStepInput(): Readonly<InputFrame> {
		if (this.playback) {
			if (this.playback.advance()) return this.playback.frame;
			this.playback = null;
		}
		return this.input;
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
		this.cancelReplay();
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
		this.cancelReplay();
		this.physics.reset();
	}

	/**
	 * Começa a gravar o InputFrame de cada passo a partir do estado atual.
	 * Reset ou troca de veículo descartam a gravação.
	 */
	startRecording(capacity?: number): void {
		const initial: ReplayInitialState = {
			vehicleId: this.currentVehicleId,
			position: { x: 0, y: 0, z: 0 },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			linearVelocity: { x: 0, y: 0, z: 0 },
			angularVelocity: { x: 0, y: 0, z: 0 },
			steeringAngle: this.state.steeringAngle,
			gear: this.state.gear,
			shiftTimeRemaining: this.state.shiftTimeRemaining,
		};
		this.physics.captureChassisState(initial);
		this.physics.applyChassisState(initial);
		this.recorder = new ReplayRecorder(capacity);
		this.recorder.start(initial, this.physicsManager.fixedTimeStep);
	}

	stopRecording(): Replay | null {
		const replay = this.recorder?.stop() ?? null;
		this.recorder = null;
		return replay;
	}

	/**
	 * Restaura o estado inicial do replay (trocando de veículo se preciso) e
	 * passa a usar os inputs gravados, um por passo, até o fim
	 */
	playReplay(replay: Replay): void {
		if (replay.fixedTimeStep !== this.physicsManager.fixedTimeStep) {
			throw new Error(
				`Replay gravado com passo ${replay.fixedTimeStep} s; o mundo usa ${this.physicsManager.fixedTimeStep} s`,
			);
		}
		if (replay.initial.vehicleId !== this.currentVehicleId) {
			if (this.changeVehicle(replay.initial.vehicleId) === false) return;
		}
		this.cancelReplay();
		this.physics.restoreChassisState(replay.initial);
		this.state.steeringAngle = replay.initial.steeringAngle;
		this.state.gear = replay.initial.gear;
		this.state.shiftTimeRemaining = replay.initial.shiftTimeRemaining;
		this.playback = new ReplayPlayback(replay);
	}

	private cancelReplay(): void {
		this.recorder = null;
		this.playback = null;
	}

	get isRecording(): boolean {
		return this.recorder !== null;
	}

	get isReplaying(): boolean {
		return this.playback !== null;
	}

	/** Passos gravados até agora */
	get recordedSteps(): number {
		return this.recorder?.stepCount ?? 0;
	}

	override getPosition(): THREE.Vector3 {
		return this.mesh.position;
	}

	/** Definição (imutável) do veículo atual */
	getDefinition(): Readonly<VehicleDefinition> {
		return this.vehicleData;
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

	getTelemetry(): Readonly<VehicleTelemetry> {
		return this.physics.telemetry;
	}

	getMovimentDirection(): THREE.Vector3 {
		const direction = VehiclePhysics.LOCAL_FORWARD.clone();
		direction.applyQuaternion(this.physics.chassisBody.getRotation(new THREE.Quaternion()));
		return direction;
	}
}
