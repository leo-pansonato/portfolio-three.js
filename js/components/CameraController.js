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

      // Forçar seguir o jogador
      this.alwaysFollowTarget = true;

      this.fixedCamera = true;

      this.selectedCamera = {
         NEAR: { distance: 2, fov: 45 },
         FAR: { distance: 5, fov: 60 },
         FIRS_PERSON: { distance: 0, fov: 75 }
      }

      // Posição inicial
      this.applyCameraPosition();
   }

   setupControls() {
      // Configura o ponto de órbita (target)
      if (this.target && this.target.getPosition) {
         this.orbitControls.target.copy(this.target.getPosition());
      }

      // Definir limites de distância (zoom)
      this.orbitControls.minDistance = 1;
      this.orbitControls.maxDistance = 15;

      // Definir limites de rotação vertical
      this.orbitControls.minPolarAngle = 0.1;
      this.orbitControls.maxPolarAngle = Math.PI / 2 - 0;

      // Suavização (inércia)
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.05;

      // Velocidade de rotação
      this.orbitControls.rotateSpeed = 0.6;

      // Velocidade de zoom
      this.orbitControls.zoomSpeed = 0.8;

      // Desabilitar movimento lateral
      this.orbitControls.enablePan = false;
   }

   update(deltaTime) {
      const timeStep = Math.min(deltaTime, 1 / 30);
      if (!this.target) return;
      
      const currentPosition = this.target.getPosition();
      
      if (this.alwaysFollowTarget) {
         const playerMovement = new THREE.Vector3().subVectors(
            currentPosition,
            this.lastTargetPosition
         );
         
         if (playerMovement.length() > 0) {
            this.camera.position.add(playerMovement);
         }
      }
      
      
      // Usar apenas um método de seguimento
      if (!this.inputManager.isMouseDown()) {
         this.applyCameraPosition(timeStep);
      }
      
      this.orbitControls.target.copy(currentPosition);
      this.lastTargetPosition.copy(currentPosition);
      this.orbitControls.update();
   }

   applyCameraPosition(deltaTime = 1/30) {
      // Obter posição do target
      const targetPosition = this.target.getPosition();
      
      // CORREÇÃO: Converter CANNON.Vec3 para THREE.Vector3
      const cannonDirection = this.target.getMovimentDirection();
      const movementDirection = new THREE.Vector3(
         cannonDirection.x, 
         cannonDirection.y, 
         cannonDirection.z
      ).normalize();
      
      // Verificar se está em marcha ré
      let isReversing = false;
      if (this.target.getCurrentSpeed) {
         isReversing = this.target.getCurrentSpeed() > -0.5;
      }
      
      // Configurações da posição da câmera
      const distanceBase = 2;  // Distância da câmera ao veículo
      const heightBase = 0.8;  // Altura da câmera
      
      const directionVector = movementDirection.clone();
      if (!isReversing) {
         directionVector.negate();
      }
      
      // Escalar pelo distanceBase
      directionVector.multiplyScalar(distanceBase);
      
      // Adicionar componente de altura
      directionVector.y = heightBase;
      
      // Calcular a nova posição da câmera
      const newCameraPosition = targetPosition.clone().add(directionVector);
      
      // Calcular fator de interpolação baseado em deltaTime
      const lerpFactor = Math.min(2.5 * deltaTime, 1.0);
      
      // Aplicar suavização para evitar movimentos bruscos (lerp)
      this.camera.position.lerp(newCameraPosition, lerpFactor);
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
