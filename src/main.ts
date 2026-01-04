import * as THREE from "three";

import CameraController from "./components/CameraController";
import Environment from "./components/Environment";
import GameComponent from "./components/GameComponent";
import Player from "./components/Player";
import InputManager from "./managers/InputManager";
import LightingManager from "./managers/LightingManager";
import PerformanceManager from "./managers/PerformanceManager";
import PhysicsManager from "./managers/PhysicsManager";
import UIManager from "./managers/UIManager";

/**
 * Classe principal do jogo
 */
class Game {
	public components: GameComponent[];
	public lastTime: number;

	public performanceManager!: PerformanceManager;
	public scene!: THREE.Scene;
	public physicsManager!: PhysicsManager;
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
		this.initialize();
	}

	initialize(): void {
		// gerenciador de desempenho
		this.performanceManager = new PerformanceManager();

		// instanciando a cena
		this.scene = new THREE.Scene();

		// instanciando o gerenciador de física
		this.physicsManager = new PhysicsManager(this.scene);

		// instanciando a camera
		this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);

		// instanciando o renderizador e adicionando ao DOM
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.VSMShadowMap;
		this.renderer.setClearColor(0xa8a8f8, 1);

		const renderMultiplier = window.devicePixelRatio;
		this.renderer.setSize(window.innerWidth, window.innerHeight, true);
		this.renderer.setPixelRatio(renderMultiplier);

		// linkando o renderizador ao container no HTML
		const container = document.getElementById("main");
		if (container) container.appendChild(this.renderer.domElement);

		// criando componentes do jogo
		this.ui = new UIManager();
		this.inputManager = new InputManager(this);
		this.environment = new Environment(this.scene, this.physicsManager);
		this.lightingManager = new LightingManager(this.scene, this.camera);
		this.player = new Player(this.scene, this.inputManager, this.physicsManager);
		this.cameraController = new CameraController(this.camera, this.player, this.inputManager);

		// Configurar materiais existentes para usar CSM
		this.lightingManager.setupCSMMaterials();

		// Adicionar componentes à lista de componentes para update automático
		this.components = [this.environment, this.lightingManager, this.player, this.cameraController, this.performanceManager];

		// redimensionamento de tela
		window.addEventListener("resize", () => this.handleResize());

		// inicia o loop do jogo
		this.gameLoopBound(performance.now());
	}

	handleResize(): void {
		const width = window.innerWidth;
		const height = window.innerHeight;

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();

		const renderMultiplier = window.devicePixelRatio;
		this.renderer.setSize(width, height, true);
		this.renderer.setPixelRatio(renderMultiplier);
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
new Game();