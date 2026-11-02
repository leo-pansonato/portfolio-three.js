import * as THREE from "three";

import CameraController from "./components/CameraController";
import Environment from "./components/Environment";
import GameComponent from "./components/GameComponent";
import Player from "./components/Player";
import InputManager from "./input/InputManager";
import { devMode } from "./managers/DevModeManager";
import LightingManager from "./managers/LightingManager";
import PerformanceManager from "./managers/PerformanceManager";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import RapierPhysicsWorld from "./physics/RapierPhysicsWorld";
import UIManager from "./managers/UIManager";

/** Configuração do pipeline de cor. A exposição pode ser sobrescrita com `?exposure=<n>` na URL. */
const RENDER_CONFIG = {
	toneMapping: THREE.AgXToneMapping as THREE.ToneMapping,
	exposure: 1.3,
	maxPixelRatio: 2,
	cameraNear: 0.1,
	cameraFar: 1000,
};

function readExposure(): number {
	const value = Number(new URLSearchParams(window.location.search).get("exposure"));
	return Number.isFinite(value) && value > 0 ? value : RENDER_CONFIG.exposure;
}

/**
 * Classe principal do jogo
 */
class Game {
	public components: GameComponent[];
	public lastTime: number;

	public performanceManager!: PerformanceManager;
	public scene!: THREE.Scene;
	public physicsManager!: PhysicsWorld;
	public camera!: THREE.PerspectiveCamera;
	public renderer!: THREE.WebGLRenderer;

	public ui!: UIManager;
	public inputManager!: InputManager;
	public environment!: Environment;
	public lightingManager!: LightingManager;
	public player!: Player;
	public cameraController!: CameraController;

	// binding do loop para manter o contexto 'this' correto no requestAnimationFrame
	private gameLoopBound: (now: number) => void;

	constructor() {
		this.components = [];
		this.lastTime = performance.now();
		this.gameLoopBound = this.gameLoop.bind(this);
	}

	/**
	 * Inicializa o jogo de forma assíncrona (aguarda o WASM do Rapier)
	 */
	async initialize(): Promise<void> {
		// gerenciador de desempenho
		this.performanceManager = new PerformanceManager();

		// instanciando a cena
		this.scene = new THREE.Scene();

		// instanciando o gerenciador de física
		this.physicsManager = await RapierPhysicsWorld.create(this.scene);

		// instanciando a camera
		this.camera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			RENDER_CONFIG.cameraNear,
			RENDER_CONFIG.cameraFar,
		);

		// instanciando o renderizador e adicionando ao DOM
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.VSMShadowMap;
		this.renderer.setClearColor(0xa8a8f8, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = RENDER_CONFIG.toneMapping;
		this.renderer.toneMappingExposure = readExposure();

		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio));
		this.renderer.setSize(window.innerWidth, window.innerHeight, true);

		// linkando o renderizador ao container no HTML
		const container = document.getElementById("main");
		if (container) container.appendChild(this.renderer.domElement);

		// criando componentes do jogo
		this.ui = new UIManager();
		this.inputManager = new InputManager();
		this.environment = new Environment(this.scene, this.physicsManager);
		this.lightingManager = new LightingManager(this.scene, this.camera);
		this.player = new Player(this.scene, this.inputManager.frame, this.physicsManager);
		this.cameraController = new CameraController(this.camera, this.player, this.inputManager.look);
		this.bindInputActions();
		this.ui.bindReplayControls(this.player);

		// Configurar materiais existentes para usar CSM
		this.lightingManager.setupCSMMaterials();

		// Adicionar componentes à lista de componentes para update automático
		this.components = [this.environment, this.lightingManager, this.player, this.cameraController, this.performanceManager];

		// redimensionamento de tela
		window.addEventListener("resize", () => this.handleResize());

		// inicia o loop do jogo
		this.gameLoopBound(performance.now());
	}

	/** Ações discretas do input tratadas por quem é dono de cada uma */
	private bindInputActions(): void {
		const input = this.inputManager;
		input.on("toggleDevMode", () => devMode.toggle());
		input.on("cycleCamera", () => this.cameraController.cycleCameraMode());
		input.on("selectVehicle1", () => void this.player.changeVehicle("bmw_f82"));
		input.on("selectVehicle2", () => void this.player.changeVehicle("mercedes_g63"));
		input.on("resetVehicle", () => this.player.resetCar());
	}

	handleResize(): void {
		const width = window.innerWidth;
		const height = window.innerHeight;

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();

		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio));
		this.renderer.setSize(width, height, true);
	}

	gameLoop(now: number): void {
		requestAnimationFrame(this.gameLoopBound);

		// deltaTime real (segundos)
		let deltaTime = (now - this.lastTime) / 1000;
		this.lastTime = now;

      // limitar deltaTime para evitar saltos grandes
		if (deltaTime > 0.1) {
			deltaTime = 0.1;
		}

		// ler dispositivos de entrada antes de qualquer consumidor
		this.inputManager.update();

		// atualizar fisica
		this.physicsManager.update(deltaTime);

		// atualizar lógica do Jogo (componentes)
		this.update(deltaTime);

		// atualizar UI
		this.ui.updatePlayerInfo(deltaTime, this.player);

		// renderizar cena (Three.js)
		this.render();
	}

	update(deltaTime: number): void {
		// atualizar todos os componentes registrados
		this.components.forEach((component) => {
			if (component.update) {
				component.update(deltaTime);
			}
		});
	}

	render(): void {
		this.renderer.render(this.scene, this.camera);
	}
}

// Iniciar o jogo
async function initGame(): Promise<void> {
	try {
		const game = new Game();
		await game.initialize();
	} catch (error) {
		console.error("Erro ao inicializar: ", error);
	}
}

void initGame();