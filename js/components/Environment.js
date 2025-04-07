import * as THREE from "three";
import GameComponent from "./GameComponent";

/**
 * Ambiente de jogo
 */
class Environment extends GameComponent {
   constructor(scene) {
      super();
      this.scene = scene;
      this.createPlane();
      this.setupLighting();
   }

   createPlane() {
      const planeGeometry = new THREE.PlaneGeometry(100, 100);
      const planeMaterial = new THREE.MeshStandardMaterial({
         color: 0xaaaaaa,
         roughness: 0.8,
      });
      const plane = new THREE.Mesh(planeGeometry, planeMaterial);
      plane.rotation.x = -Math.PI / 2;
      plane.receiveShadow = true;
      this.scene.add(plane);
   }

   setupLighting() {
      // Luz ambiente
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(ambientLight);

      // Luz direcional principal
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(10, 10, 10);
      directionalLight.castShadow = true;
      directionalLight.shadow.mapSize.width = 2048;
      directionalLight.shadow.mapSize.height = 2048;
      this.scene.add(directionalLight);
   }
}

export default Environment;