import * as CANNON from "cannon-es";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import PhysicsManager from "../managers/PhysicsManager";
import GameComponent from "./GameComponent";

/**
 * Ambiente de jogo
 */
export default class Environment extends GameComponent {
  private scene: THREE.Scene;
  private physicsManager: PhysicsManager;

  constructor(scene: THREE.Scene, physicsManager: PhysicsManager) {
    super();
    this.scene = scene;
    this.physicsManager = physicsManager;

    this.createPlane();
    // this.createCubeSkybox("../textures/cartoonSkybox/");
    this.createRGBESkybox("../textures/realisticSkybox/", "dawn_4k.hdr");
    this.createObstacles();
  }

  createPlane(): void {
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

  createCubeSkybox(path: string): void {
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

  createRGBESkybox(path: string, file: string): void {
    const loader = new RGBELoader();
    loader.load(
      path + file,
      (texture) => {
        texture.mapping = THREE.EquirectangularRefractionMapping;
        // @ts-ignore: Propriedade existe em texturas carregadas mas types podem reclamar
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

  createObstacles(): void {
    // caixas como obstáculos
    const obstaclePositions = [
      { x: 5, y: 3, z: 5 },
      { x: -5, y: 3, z: 8 },
      { x: 8, y: 3, z: -5 },
    ];

    obstaclePositions.forEach((pos) => {
      // Criar caixa visual
      const boxSize = { x: 3, y: 3, z: 3 };
      const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const boxMaterial = new THREE.MeshStandardMaterial({
        roughness: 0.4,
        color: 0xaa4444,
      });
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

}
