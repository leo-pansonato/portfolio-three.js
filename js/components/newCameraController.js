import * as THREE from "three";
import GameComponent from "./GameComponent.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Controlador de câmera usando OrbitControls
 */
class CameraController extends GameComponent {
   constructor(camera, target, inputManager) {
      super();
      this.camera = camera;
      this.target = target;
      this.inputManager = inputManager;

      // Criar o controlador OrbitControls
      this.orbitControls = new OrbitControls(this.camera, document.getElementById("main"));

      // Configurações iniciais
      this.setupControls();

      // Salvar a posição inicial do alvo para acompanhamento
      this.lastTargetPosition = new THREE.Vector3();
      if (this.target && this.target.getPosition) {
         this.lastTargetPosition.copy(this.target.getPosition());
      }

      // offset para seguir o jogador
      this.cameraOffset = new THREE.Vector3(0, 1, 10);

      // Forçar seguir o jogador
      this.alwaysFollowTarget = true;

      // Posição inicial
      // this.resetCameraPosition();
   }

   setupControls() {
      // Configura o ponto de órbita (target)
      if (this.target && this.target.getPosition) {
         this.orbitControls.target.copy(this.target.getPosition());
      }

      // Definir limites de distância (zoom)
      this.orbitControls.minDistance = 3;
      this.orbitControls.maxDistance = 30;

      // Definir limites de rotação vertical
      this.orbitControls.minPolarAngle = 0.1;
      this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.1;

      // Suavização (inércia)
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;

      // Velocidade de rotação
      this.orbitControls.rotateSpeed = 0.8;

      // Velocidade de zoom
      this.orbitControls.zoomSpeed = 0.8;

      // Desabilitar movimento lateral
      this.orbitControls.enablePan = false;
   }

   update(deltaTime) {
      if (!this.target || !this.target.getPosition) return;

      // Verifique se o alvo moveu-se e atualize o centro da órbita
      const currentPosition = this.target.getPosition();

      // Atualizar o centro da órbita para a nova posição do alvo
      this.orbitControls.target.copy(currentPosition);

      // Atualizar a posição de referência
      if (this.alwaysFollowTarget) {
         const playerMovement = new THREE.Vector3().subVectors(
            currentPosition,
            this.lastTargetPosition
         );

         if (playerMovement.length() > 0) {
            this.camera.position.add(playerMovement);
         }
      }

      // Atualizar a posição de referência
      this.lastTargetPosition.copy(currentPosition);

      // (para inércia/suavização funcionarem)
      this.orbitControls.update();
   }

   // Método para alterar suavização
   setSmoothing(enabled, factor = 0.05) {
      this.orbitControls.enableDamping = enabled;
      if (enabled) {
         this.orbitControls.dampingFactor = factor;
      }
   }

   // Método para obter a posição atual da câmera
   getPosition() {
      return this.camera.position;
   }

   // Método para habilitar/desabilitar os controles
   enable(enabled = true) {
      this.orbitControls.enabled = enabled;
   }
}

export default CameraController;
