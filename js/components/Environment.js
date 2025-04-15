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
     this.createSkybox("../textures/cartoonSkybox/");
    // this.createHdrSkybox("../textures/realisticSkybox/", "golden_gate_hills_4k.hdr");
    // this.setupLighting();
    this.createObstacles();
  }

  createPlane() {
    // Plano visual
    const planeGeometry = new THREE.PlaneGeometry(100, 100);
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
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

  createSkybox(path) {
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

  createHdrSkybox(path, file) {
    const loader = new RGBELoader();
    loader.load(path + file, (texture) => {
      texture.mapping = THREE.EquirectangularRefractionMapping;
      texture.needsUpdate = true;
      this.scene.background = texture;
      this.scene.environment = texture;
    });
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
      const boxMaterial = new THREE.MeshStandardMaterial({ color: 0xaa4444 });
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
      boxMesh.position.set(pos.x, pos.y, pos.z);
      boxMesh.castShadow = true;
      boxMesh.receiveShadow = true;
      this.scene.add(boxMesh);

      // Criar corpo físico
      const boxShape = new CANNON.Box(new CANNON.Vec3(boxSize.x / 2, boxSize.y / 2, boxSize.z / 2));
      const boxBody = new CANNON.Body({ mass: 5 });
      boxBody.addShape(boxShape);
      boxBody.position.set(pos.x, pos.y, pos.z);

      // Adicionar ao gerenciador de física
      this.physicsManager.addBody(boxBody, boxMesh);
    });
  }

  setupLighting() {
    // Luz ambiente
    const ambientLight = new THREE.AmbientLight(0xffffff, 2);
    this.scene.add(ambientLight);

    // Luz principal
    const directionalLight = new THREE.PointLight(0xffffff, 2000);
    directionalLight.position.set(10, 20, 0);
    directionalLight.castShadow = true;

    // Aumentar o tamanho do shadow map
    directionalLight.shadow.mapSize.width = 4096;
    directionalLight.shadow.mapSize.height = 4096;

    // Configurar a câmera de sombra para cobrir toda a área do plano
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.near = 1;

    // Ajuste o bias para evitar artefatos de sombra
    directionalLight.shadow.bias = -0.0005;

    this.scene.add(directionalLight);
  }
}

export default Environment;
