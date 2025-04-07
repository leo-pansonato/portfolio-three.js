import * as THREE from 'three';
import GameComponent from "./GameComponent.js";


/**
 * Controlador de câmera
 */
class CameraController extends GameComponent {
   constructor(camera, target, inputManager) {
      super();
      this.camera = camera;
      this.target = target;
      this.inputManager = inputManager;

      // Configurações da câmera
      this.distance = 10; // Distância da câmera para o alvo
      this.cameraHeight = 1; // Altura da câmera em relação ao alvo

      // Ângulos de rotação (em radianos)
      this.horizontalAngle = Math.PI; // Rotação horizontal (em torno do eixo Y)
      this.verticalAngle = 0.3; // Rotação vertical (inclinação)

      // Limites da inclinação vertical
      this.minVerticalAngle = 0.01;
      this.maxVerticalAngle = Math.PI / 2 - 0.1;

      // Velocidade da rotação
      this.rotationSpeed = 0.003;

      // Sistema de inércia
      this.momentum = {
         horizontal: 0,
         vertical: 0,
         active: false,
         friction: 0.98, // fator de desaceleração
         minSpeed: 0.001, // limiar mínimo para parar a câmera
      };

      // Configurações de zoom
      this.minDistance = 3;
      this.maxDistance = 30;
      this.zoomSpeed = 0.5;

      this.cameraLookOffset = new THREE.Vector3(0, 0, 0);
   }

   update(deltaTime) {
      if (!this.target || !this.camera || !this.inputManager) return;

      const deltaTimeAdjusted = Math.min(deltaTime, 0.1) * 60; // Evita deltas muito grandes

      // Verifica se o botão do mouse está pressionado
      if (this.inputManager.isMouseDown()) {
         // Estamos movendo ativamente a câmera, desative a inércia
         const mouseDelta = this.inputManager.getMouseDelta();

         // Limpa o delta do mouse após usá-lo
         this.inputManager.resetMouseDelta();

         // Armazena velocidade atual para inércia
         this.momentum.horizontal = -mouseDelta.x * this.rotationSpeed;
         this.momentum.vertical = mouseDelta.y * this.rotationSpeed;

         // Atualiza os ângulos diretamente
         this.horizontalAngle += this.momentum.horizontal;
         this.verticalAngle += this.momentum.vertical;

         // Marca que está em modo ativo
         this.momentum.active = true;
      } else if (this.momentum.active) {
         // Aplicar inércia quando o mouse é solto
         this.horizontalAngle += this.momentum.horizontal * deltaTimeAdjusted;
         this.verticalAngle += this.momentum.vertical * deltaTimeAdjusted;

         // Aplicar atrito para desacelerar gradualmente
         this.momentum.horizontal *= this.momentum.friction;
         this.momentum.vertical *= this.momentum.friction;

         // Verificar se a velocidade caiu abaixo do limiar mínimo
         if (
            Math.abs(this.momentum.horizontal) < this.momentum.minSpeed &&
            Math.abs(this.momentum.vertical) < this.momentum.minSpeed
         ) {
            this.momentum.horizontal = 0;
            this.momentum.vertical = 0;
            this.momentum.active = false;
         }
      }

      // Limitar o ângulo vertical para não virar demais
      this.verticalAngle = Math.max(
         this.minVerticalAngle,
         Math.min(this.maxVerticalAngle, this.verticalAngle)
      );

      // Calcula a posição da câmera com base nos ângulos
      const targetPosition = this.target.getPosition().clone();

      // Cálculo da posição usando coordenadas esféricas
      const x =
         Math.sin(this.horizontalAngle) * Math.cos(this.verticalAngle) * this.distance;
      const y = Math.sin(this.verticalAngle) * this.distance + this.cameraHeight;
      const z =
         Math.cos(this.horizontalAngle) * Math.cos(this.verticalAngle) * this.distance;

      // Posiciona a câmera diretamente sem suavização
      this.camera.position.set(
         targetPosition.x + x,
         targetPosition.y + y,
         targetPosition.z + z
      );

      // A câmera sempre olha para o alvo
      const lookAtPosition = targetPosition.clone().add(this.cameraLookOffset);
      this.camera.lookAt(lookAtPosition);
   }

   // Método para ajustar o zoom
   adjustZoom(amount) {
      const newDistance = this.distance + amount * this.zoomSpeed;
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, newDistance));
   }
}

export default CameraController;