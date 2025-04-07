import * as THREE from "three";
import Entity from "./Entity";

/**
 * Personagem jogável
 */
class Player extends Entity {
   constructor(scene, inputManager) {
      super(scene);
      this.inputManager = inputManager;
      this.movementSpeed = 0.2;
      this.rotationSpeed = 0.05;
      this.currentSpeed = 0;
      this.createMesh();
      this.addToScene();
   }

   createMesh() {
      const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
      const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      this.mesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
      this.mesh.position.y = 0.5; // meio bloco acima do chão
   }

   update(deltaTime) {
      // Normaliza o movimento baseado no delta de tempo
      const timeAdjustedSpeed = this.movementSpeed * deltaTime * 60; // base 60 fps
      const timeAdjustedRotation = this.rotationSpeed * deltaTime * 60;

      this.currentSpeed = 0;

      // Movimento baseado nas teclas
      if (this.inputManager.isKeyPressed("arrowup")) {
         this.moveForward(timeAdjustedSpeed);
         this.currentSpeed = timeAdjustedSpeed;
      }
      if (this.inputManager.isKeyPressed("arrowdown")) {
         this.moveBackward(timeAdjustedSpeed);
         this.currentSpeed = -timeAdjustedSpeed;
      }
      if (this.inputManager.isKeyPressed("arrowleft")) {
         this.rotateLeft(timeAdjustedRotation);
      }
      if (this.inputManager.isKeyPressed("arrowright")) {
         this.rotateRight(timeAdjustedRotation);
      }
   }

   moveForward(speed) {
      const direction = new THREE.Vector3(0, 0, -speed);
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      this.mesh.position.add(direction);
   }

   moveBackward(speed) {
      const direction = new THREE.Vector3(0, 0, speed);
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      this.mesh.position.add(direction);
   }

   rotateLeft(speed) {
      this.mesh.rotation.y += speed;
   }

   rotateRight(speed) {
      this.mesh.rotation.y -= speed;
   }

   getCurrentSpeed() {
      return this.currentSpeed;
   }
}

export default Player;