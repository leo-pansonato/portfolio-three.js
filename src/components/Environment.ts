import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import PhysicsManager from "../managers/PhysicsManager";
import GameComponent from "./GameComponent";
import ProceduralTerrain, { TerrainConfig } from "./ProceduralTerrain";

/**
 * Ambiente de jogo
 */
export default class Environment extends GameComponent {
  private scene: THREE.Scene;
  private physicsManager: PhysicsManager;
  private terrain: ProceduralTerrain | null = null;

  constructor(scene: THREE.Scene, physicsManager: PhysicsManager) {
    super();
    this.scene = scene;
    this.physicsManager = physicsManager;

    // Usar terreno procedural ao invés do plano simples
    this.createProceduralTerrain();
    // this.createPlane(); // Plano simples (alternativa)

    // this.createCubeSkybox("../textures/cartoonSkybox/");
    this.createRGBESkybox("../textures/realisticSkybox/", "dawn_4k.hdr");
    this.createObstacles();
  }

  /**
   * Cria terreno procedural com elevações
   */
  createProceduralTerrain(): void {
    const terrainConfig: Partial<TerrainConfig> = {
      width: 1000,
      depth: 1000,
      widthSegments: 128,      // Resolução do terreno
      depthSegments: 182,
      maxHeight: 2,           // Altura máxima das colinas
      minHeight: 1,          // Profundidade dos vales
      seed: 12345,            // Seed para geração determinística
      noiseScale: 0.025,      // Escala do noise (menor = colinas maiores)
      octaves: 5,             // Camadas de detalhe
      lacunarity: 2.2,        // Aumento de frequência por oitava
      persistence: 0.45,      // Diminuição de amplitude por oitava
      useRidged: false,       // true para montanhas mais acentuadas
      edgeFalloff: true,      // Suavizar bordas
      falloffDistance: 0.5,   // Distância do falloff
    };

    // Cores do terreno baseadas em altura
    const colorConfig = {
      lowColor: new THREE.Color(0x3d6b35),    // Verde escuro (grama baixa)
      midColor: new THREE.Color(0x5a4d3a),    // Marrom (terra)
      highColor: new THREE.Color(0x7a7a7a),   // Cinza (rocha)
      lowThreshold: 0.25,
      highThreshold: 0.65,
    };

    this.terrain = new ProceduralTerrain(
      this.scene,
      this.physicsManager,
      terrainConfig,
      colorConfig
    );

    this.terrain.generate();
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

    // Plano físico com Rapier
    // No Rapier, usamos um RigidBody estático com um collider cuboid grande e fino
    const groundBody = this.physicsManager.createRigidBody({
      type: "static",
      position: { x: 0, y: 0, z: 0 },
    });

    // Criar collider de chão (cuboid grande e fino)
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
    // caixas como obstáculos - posicionadas considerando o terreno
    const obstaclePositions = [
      { x: 15, z: 15 },
      { x: -15, z: 18 },
      { x: 18, z: -15 },
      { x: -20, z: -20 },
      { x: 25, z: 0 },
      { x: 0, z: 30 },
    ];

    obstaclePositions.forEach((pos) => {
      // Obter altura do terreno na posição
      const terrainHeight = this.terrain?.getHeightAt(pos.x, pos.z) ?? 0;
      const boxSize = { x: 3, y: 3, z: 3 };
      const y = terrainHeight + boxSize.y / 2 + 1; // Meio da caixa + pequeno offset

      // Criar caixa visual
      const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const boxMaterial = new THREE.MeshStandardMaterial({
        roughness: 0.4,
        color: 0xaa4444,
      });
      const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
      boxMesh.position.set(pos.x, y, pos.z);
      boxMesh.castShadow = true;
      boxMesh.receiveShadow = true;
      this.scene.add(boxMesh);

      // Criar RigidBody dinâmico para o obstáculo
      const boxBody = this.physicsManager.createRigidBody({
        type: "dynamic",
        position: { x: pos.x, y: y, z: pos.z },
        linearDamping: 0.2,
        angularDamping: 0.01,
      });

      // Criar Collider para o obstáculo (cuboid com metade das dimensões)
      this.physicsManager.createCollider(
        {
          shape: "cuboid",
          halfExtents: {
            x: boxSize.x / 2,
            y: boxSize.y / 2,
            z: boxSize.z / 2,
          },
          friction: 0.5,
          restitution: 0.3,
          density: 1.0, // Define a massa através da densidade
        },
        boxBody
      );

      // Adicionar ao gerenciador de física para sincronização automática
      this.physicsManager.addEntity(boxBody, boxMesh);
    });
  }

  /**
   * Obtém a altura do terreno em uma posição mundial
   */
  getTerrainHeightAt(x: number, z: number): number {
    return this.terrain?.getHeightAt(x, z) ?? 0;
  }

  /**
   * Obtém a normal do terreno em uma posição mundial
   */
  getTerrainNormalAt(x: number, z: number): THREE.Vector3 {
    return this.terrain?.getNormalAt(x, z) ?? new THREE.Vector3(0, 1, 0);
  }

  /**
   * Regenera o terreno com nova seed
   */
  regenerateTerrain(seed?: number): void {
    this.terrain?.regenerate(seed);
  }

  /**
   * Obtém referência ao terreno procedural
   */
  getTerrain(): ProceduralTerrain | null {
    return this.terrain;
  }
}
