import * as THREE from "three";

import CameraController from "./components/newCameraController";
import Environment from "./components/Environment";
import Player from "./components/Player";
import InputManager from "./managers/InputManager";
import PerformanceManager from "./managers/PerformanceManager";
import UIManager from "./managers/UIManager";


/**
 * Classe principal do jogo
 */
class Game {
   constructor() {
      this.components = [];
      this.lastTime = performance.now();
      this.initialize();
   }

   initialize() {
      // Criando o gerenciador de desempenho
      this.performanceManager = new PerformanceManager(240);

      // Instanciando a cena
      this.scene = new THREE.Scene();

      // Instanciando a camera
      const FOV = 75;
      this.camera = new THREE.PerspectiveCamera(
         FOV,
         window.innerWidth / window.innerHeight,
         0.1,
         1000
      );

      // Instanciando o renderizador e adicionando ao DOM
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const renderMultiplier = window.devicePixelRatio;
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.setPixelRatio(renderMultiplier);
      document.getElementById("main").appendChild(this.renderer.domElement);

      // Criando componentes do jogo
      this.ui = new UIManager();
      this.inputManager = new InputManager(this);
      this.environment = new Environment(this.scene);
      this.player = new Player(this.scene, this.inputManager);
      this.cameraController = new CameraController(
         this.camera,
         this.player,
         this.inputManager
      );

      // Adicionar componentes à lista de componentes
      this.components.push(this.environment, this.player, this.cameraController);

      // Redimensionamento de tela
      window.addEventListener("resize", () => this.handleResize());

      // Inicia o loop do jogo
      this.gameLoop = this.gameLoop.bind(this);
      requestAnimationFrame(this.gameLoop);
   }

   handleResize() {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(width, height, false);
   }

   gameLoop(now) {
      // Verificar se é hora de renderizar um novo quadro
      if (this.performanceManager.update(now)) {
         const deltaTime = this.performanceManager.getDeltaTime();

         // Atualizar estado do jogo
         this.update(deltaTime);

         // Renderizar cena
         this.render();

         // Atualizar UI
         this.ui.updatePlayerInfo(
            this.player.getPosition(),
            this.player.getRotation(),
            this.player.getCurrentSpeed() * 60 // unidades por segundo
         );
      }

      // Continua o loop
      requestAnimationFrame(this.gameLoop);
   }

   update(deltaTime) {
      // Atualizar todos os componentes registrados
      this.components.forEach((component) => {
         if (component.update) {
            component.update(deltaTime);
         }
      });
   }

   render() {
      this.renderer.render(this.scene, this.camera);
   }
}

// Iniciar o jogo
const game = new Game();