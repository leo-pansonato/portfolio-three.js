import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
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
    this.createHDRSkybox("../textures/realisticSkybox/", "dawn_4k.hdr");
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

    // Plano físico: corpo estático com um cuboid fino (superfície em y = 0)
    const groundBody = this.physicsManager.createRigidBody({
      type: "static",
      position: { x: 0, y: 0, z: 0 },
    });
    this.physicsManager.createGroundCollider(groundBody, 0.8);
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

  /** Céu e iluminação de ambiente a partir de um HDR equiretangular (o renderer gera o PMREM de `scene.environment`). */
  createHDRSkybox(path: string, file: string): void {
    const loader = new HDRLoader();
    loader.load(
      path + file,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
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

      // Criar corpo físico (massa de 5, como na versão cannon-es)
      const boxBody = this.physicsManager.createRigidBody({
        type: "dynamic",
        position: { x: pos.x, y: pos.y, z: pos.z },
      });
      this.physicsManager.createCollider(
        {
          shape: "cuboid",
          halfExtents: { x: boxSize.x / 2, y: boxSize.y / 2, z: boxSize.z / 2 },
          density: 5 / (boxSize.x * boxSize.y * boxSize.z),
        },
        boxBody
      );

      // Adicionar ao gerenciador de física
      this.physicsManager.addEntity(boxBody, boxMesh);
    });
  }

}
