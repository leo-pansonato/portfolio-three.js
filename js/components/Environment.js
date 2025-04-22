import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import * as CANNON from "cannon-es";
import GameComponent from "./GameComponent";

/**
 * Ambiente de jogo
 */
class Environment extends GameComponent {
   constructor(scene, physicsManager) {
      super();
      this.scene = scene;
      this.physicsManager = physicsManager;
      this.createPlane();
      // this.createCubeSkybox("../textures/cartoonSkybox/");
      this.createRGBESkybox("../textures/realisticSkybox/", "dawn_4k.hdr");
      this.setupLighting();
      this.createObstacles();
   }

   createPlane() {
      // Plano visual
      const planeGeometry = new THREE.PlaneGeometry(200, 200);
      const planeMaterial = new THREE.MeshStandardMaterial({
         color: 0x0f0f0f,
         roughness: 0.7,
      });
      const plane = new THREE.Mesh(planeGeometry, planeMaterial);
      plane.rotation.x = -Math.PI / 2;
      plane.receiveShadow = true;
      this.scene.add(plane);

      // Plano físico
      const groundShape = new CANNON.Plane();
      const groundBody = new CANNON.Body({
         mass: 0,
         material: this.physicsManager.getGroundMaterial(),
      });
      groundBody.addShape(groundShape);
      groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Rotação para corresponder ao plano visual

      this.physicsManager.world.addBody(groundBody);
   }

   createCubeSkybox(path) {
      const loader = new THREE.CubeTextureLoader();

      loader.load(
         [
            path + "px.jpg",
            path + "nx.jpg",
            path + "py.jpg",
            path + "ny.jpg",
            path + "pz.jpg",
            path + "nz.jpg",
         ],
         (texture) => {
            this.scene.background = texture;
            this.scene.environment = texture;
            console.log("Skybox loaded successfully");
         }
      );
   }

   createRGBESkybox(path, file) {
      const loader = new RGBELoader();
      loader.load(
         path + file,
         (texture) => {
            texture.mapping = THREE.EquirectangularRefractionMapping;
            texture.needsUpdate = true;
            this.scene.background = texture;
            this.scene.environment = texture;
         },
         undefined,
         (error) => {
            console.error("Erro ao carregar o skybox HDR", error);
         }
      );
   }

   createObstacles() {
      // caixas como obstáculos
      const obstaclePositions = [
         { x: 5, y: 1, z: 5 },
         { x: -5, y: 1, z: 8 },
         { x: 8, y: 1, z: -5 },
      ];

      obstaclePositions.forEach((pos) => {
         // Criar caixa visual
         const boxSize = { x: 1, y: 1, z: 1 };
         const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
         const boxMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4,  color: 0xaa4444 });
         const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
         boxMesh.position.set(pos.x, pos.y, pos.z);
         boxMesh.castShadow = true;
         boxMesh.receiveShadow = true;
         this.scene.add(boxMesh);

         // Criar corpo físico
         const boxShape = new CANNON.Box(
            new CANNON.Vec3(boxSize.x / 2, boxSize.y / 2, boxSize.z / 2)
         );
         const boxBody = new CANNON.Body({ mass: 5 });
         boxBody.addShape(boxShape);
         boxBody.position.set(pos.x, pos.y, pos.z);

         // Adicionar ao gerenciador de física
         this.physicsManager.addBody(boxBody, boxMesh);
      });
   }

   setupLighting() {
      // Luz principal que segue o player
      const directionalLight = new THREE.DirectionalLight(0xf6ad8f);
      directionalLight.position.set(15, 10, 10);
      directionalLight.target.position.set(0, 0, 0);
      directionalLight.intensity = 10;

      directionalLight.castShadow = true;

      // Aumentar o tamanho do shadow map
      directionalLight.shadow.mapSize.width = 4096;
      directionalLight.shadow.mapSize.height = 4096;

      // Configurar limites da câmera de sombra para acompanhar o player
      const d = 20; // tamanho da área de sombra
      directionalLight.shadow.camera.left = -d;
      directionalLight.shadow.camera.right = d;
      directionalLight.shadow.camera.top = d;
      directionalLight.shadow.camera.bottom = -d;
      directionalLight.shadow.camera.far = 50;
      directionalLight.shadow.camera.near = 0.1;

      // Evitar artefatos de sombra
      directionalLight.shadow.bias = -0.001;

      // const helper = new THREE.DirectionalLightHelper(directionalLight, 5, 0xff0000);
      // this.scene.add(helper);

      // Adicionar a luz à cena
      this.scene.add(directionalLight);
      this.scene.add(directionalLight.target);

      // Salvar referência para atualizar na função update
      this.directionalLight = directionalLight;
   }

   // Atualizar a posição da luz
   update(deltaTime, playerPosition) {
      if (playerPosition && this.directionalLight) {
         // Atualizar a posição da luz para seguir o player
         this.directionalLight.position.set(
            playerPosition.x + 15,
            playerPosition.y + 10,
            playerPosition.z + 10
         );

         // Atualizar o alvo da luz para apontar para o player
         this.directionalLight.target.position.set(
            playerPosition.x,
            playerPosition.y,
            playerPosition.z
         );
      }
   }
}

export default Environment;
