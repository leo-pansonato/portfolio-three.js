import * as THREE from "three";
import Entity from "./Entity";

/**
 * Player jogavel
 */
class Player extends Entity {
   constructor(scene, inputManager) {
      super(scene);
      this.inputManager = inputManager;
      
      // Configurações do veículo
      this.maxSpeed = 0.3;          // Velocidade máxima
      this.acceleration = 0.005;    // Taxa de aceleração
      this.brakeForce = 0.01;       // Força de frenagem
      this.deceleration = 0.002;    // Desaceleração natural (atrito)
      this.steeringSpeed = 0.01;    // Velocidade de esterçamento
      this.maxSteering = 0.08;       // Ângulo máximo de esterçamento (radianos)
      this.steeringReturn = 0.005;    // Velocidade de retorno do esterçamento
      
      // Estado atual do veículo
      this.velocity = 0;            // Velocidade atual
      this.steering = 0;            // Ângulo de esterçamento atual (-1 a 1)

      this.createMesh();
      this.addToScene();
   }

   createMesh() {
      // Por enquanto mantemos o cubo, mas podemos substituir por um modelo 3D de carro
      const carBody = new THREE.BoxGeometry(1, 0.5, 2); // Proporções mais parecidas com um carro
      const carMaterial = new THREE.MeshStandardMaterial({ color: 0x3344ff });
      this.mesh = new THREE.Mesh(carBody, carMaterial);
      
      // Adicionar marcadores para frente/trás para visualização
      const frontMarker = new THREE.Mesh(
         new THREE.BoxGeometry(0.2, 0.2, 0.2),
         new THREE.MeshStandardMaterial({ color: 0xff0000 })
      );
      frontMarker.position.z = -1; // Frente do carro
      this.mesh.add(frontMarker);
      
      this.mesh.position.y = 0.25; // Metade da altura acima do chão
      this.mesh.castShadow = true;
   }

   update(deltaTime) {
      // Normaliza o tempo para consistência
      const timeAdjusted = deltaTime * 60; // base 60 fps
      
      // Controle de aceleração/frenagem
      if (this.inputManager.isKeyPressed("arrowup")) {
         // Acelerar
         this.velocity += this.acceleration * timeAdjusted;
      } else if (this.inputManager.isKeyPressed("arrowdown")) {
         if (this.velocity > 0) {
            // Frear quando o carro está em movimento para frente
            this.velocity -= this.brakeForce * timeAdjusted;
         } else if (this.velocity > -this.maxSpeed * 0.5) {
            // Marcha à ré (mais lenta que para frente)
            this.velocity -= this.acceleration * 0.5 * timeAdjusted;
         }
      } else {
         // Desaceleração natural quando nenhum controle é pressionado
         if (Math.abs(this.velocity) < this.deceleration * timeAdjusted) {
            this.velocity = 0; // Parar completamente se a velocidade for muito baixa
         } else if (this.velocity > 0) {
            this.velocity -= this.deceleration * timeAdjusted;
         } else if (this.velocity < 0) {
            this.velocity += this.deceleration * timeAdjusted;
         }
      }
      
      // Limitar a velocidade máxima
      this.velocity = Math.max(-this.maxSpeed * 0.5, Math.min(this.maxSpeed, this.velocity));
      
      // Controle de direção (esterçamento)
      if (this.inputManager.isKeyPressed("arrowright")) {
         // O esterçamento é mais efetivo em movimento
         const steeringFactor = Math.abs(this.velocity) > 0.01 ? 1 : 0.2;
         this.steering -= this.steeringSpeed * steeringFactor * timeAdjusted;
      } else if (this.inputManager.isKeyPressed("arrowleft")) {
         const steeringFactor = Math.abs(this.velocity) > 0.01 ? 1 : 0.2;
         this.steering += this.steeringSpeed * steeringFactor * timeAdjusted;
      } else {
         // Retorno automático do volante à posição central
         if (Math.abs(this.steering) < this.steeringReturn * timeAdjusted) {
            this.steering = 0;
         } else if (this.steering > 0) {
            this.steering -= this.steeringReturn * timeAdjusted;
         } else {
            this.steering += this.steeringReturn * timeAdjusted;
         }
      }
      
      // Limitar o ângulo de esterçamento
      this.steering = Math.max(-this.maxSteering, Math.min(this.maxSteering, this.steering));
      
      // Aplicar movimento baseado na velocidade e esterçamento
      if (Math.abs(this.velocity) > 0.001) {
         // Rotação do carro baseado no esterçamento e velocidade
         // A velocidade afeta o raio de curvatura (curvas mais abertas em alta velocidade)
         const steeringEffect = this.steering * (Math.abs(this.velocity) / this.maxSpeed);
         this.mesh.rotation.y += steeringEffect * (this.velocity > 0 ? 1 : -1) * timeAdjusted;
         
         // Movimento para frente/trás na direção atual
         const direction = new THREE.Vector3(0, 0, -1);
         direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
         direction.multiplyScalar(this.velocity * timeAdjusted);
         this.mesh.position.add(direction);
      }
      
      // Atualizar a velocidade atual para UI
      this.currentSpeed = this.velocity;
   }

   getCurrentSpeed() {
      return this.currentSpeed;
   }
}

export default Player;