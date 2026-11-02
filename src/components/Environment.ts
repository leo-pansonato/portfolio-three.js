import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { PhysicsBody, PhysicsWorld } from "../physics/PhysicsWorld";
import { disposeObjects } from "../render/disposeObjects";
import GameComponent from "./GameComponent";

/**
 * Ambiente de jogo: dono do plano, das caixas (meshes e corpos) e da textura do céu
 */
export default class Environment extends GameComponent {
	private scene: THREE.Scene;
	private physicsWorld: PhysicsWorld;
	private objects: THREE.Object3D[] = [];
	private bodies: PhysicsBody[] = [];
	private skyTextures: THREE.Texture[] = [];
	private disposed = false;

	constructor(scene: THREE.Scene, physicsWorld: PhysicsWorld) {
		super();
		this.scene = scene;
		this.physicsWorld = physicsWorld;

		this.createPlane();
		// this.createCubeSkybox("../textures/cartoonSkybox/");
		this.createHDRSkybox("../textures/realisticSkybox/", "dawn_4k.hdr");
		this.createObstacles();
	}

	createPlane(): void {
		// Plano visual
		const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
		const planeMaterial = new THREE.MeshStandardMaterial({
			color: 0x3a3a3a,
			roughness: 0.7,
		});
		const plane = new THREE.Mesh(planeGeometry, planeMaterial);
		plane.rotation.x = -Math.PI / 2;
		plane.receiveShadow = true;
		this.scene.add(plane);
		this.objects.push(plane);

		// Plano físico: corpo estático com um cuboid fino (superfície em y = 0)
		const groundBody = this.physicsWorld.createRigidBody({
			type: "static",
			position: { x: 0, y: 0, z: 0 },
		});
		this.physicsWorld.createGroundCollider(groundBody, 0.8, 1000);
		this.bodies.push(groundBody);
	}

	createCubeSkybox(path: string): void {
		const loader = new THREE.CubeTextureLoader();

		loader.load(
			[path + "px.jpg", path + "nx.jpg", path + "py.jpg", path + "ny.jpg", path + "pz.jpg", path + "nz.jpg"],
			(texture) => {
				if (this.disposed) {
					texture.dispose();
					return;
				}
				this.skyTextures.push(texture);
				this.scene.background = texture;
				this.scene.environment = texture;
				console.log("Skybox loaded successfully");
			},
		);
	}

	/** Céu e iluminação de ambiente a partir de um HDR equiretangular (o renderer gera o PMREM de `scene.environment`). */
	createHDRSkybox(path: string, file: string): void {
		const loader = new HDRLoader();
		loader.load(
			path + file,
			(texture) => {
				if (this.disposed) {
					texture.dispose();
					return;
				}
				this.skyTextures.push(texture);
				texture.mapping = THREE.EquirectangularReflectionMapping;
				this.scene.background = texture;
				this.scene.environment = texture;
			},
			undefined,
			(error) => {
				console.error("Erro ao carregar o skybox HDR", error);
			},
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
			this.objects.push(boxMesh);

			// Criar corpo físico (massa de 5, como na versão cannon-es)
			const boxBody = this.physicsWorld.createRigidBody({
				type: "dynamic",
				position: { x: pos.x, y: pos.y, z: pos.z },
			});
			this.physicsWorld.createCollider(
				{
					shape: "cuboid",
					halfExtents: { x: boxSize.x / 2, y: boxSize.y / 2, z: boxSize.z / 2 },
					density: 5 / (boxSize.x * boxSize.y * boxSize.z),
				},
				boxBody,
			);

			// Adicionar ao gerenciador de física
			this.physicsWorld.addEntity(boxBody, boxMesh);
			this.bodies.push(boxBody);
		});
	}

	/** Remove da cena e do mundo físico o que o ambiente criou e libera geometrias, materiais e a textura do céu */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		disposeObjects(this.objects);
		this.objects = [];
		for (const body of this.bodies) this.physicsWorld.removeRigidBody(body);
		this.bodies = [];

		for (const texture of this.skyTextures) {
			if (this.scene.background === texture) this.scene.background = null;
			if (this.scene.environment === texture) this.scene.environment = null;
			texture.dispose();
		}
		this.skyTextures = [];
	}
}
