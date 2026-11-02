import * as THREE from "three";
import { VehicleDefinition } from "../data/vehicles";
import ModelLoader from "../loaders/ModelLoader";
import { disposeObjects } from "../render/disposeObjects";

export interface LoadedVehicle {
	body: THREE.Object3D | THREE.Mesh;
	wheels: THREE.Object3D[];
}

/**
 * Carrega os modelos de um veículo a partir da definição, com fallback para primitivas.
 * Os objetos devolvidos ficam fora da cena e voltam por `releaseObjects`.
 */
export default class VehicleManager {
	private modelLoader: ModelLoader;

	constructor(modelLoader: ModelLoader = new ModelLoader()) {
		this.modelLoader = modelLoader;
	}

	/** Remove os objetos da cena, libera seus recursos próprios e devolve ao cache os modelos carregados */
	releaseObjects(objects: THREE.Object3D[]): void {
		disposeObjects(objects, (resource) => this.modelLoader.isCached(resource));
		for (const object of objects) this.modelLoader.releaseModel(object);
	}

	/**
	 * Carrega chassi e rodas de um veículo
	 * @param wheelCount Número de rodas do veículo
	 */
	async loadVehicle(vehicleConfig: VehicleDefinition, wheelCount: number = 4): Promise<LoadedVehicle> {
		try {
			// Carregar corpo e rodas em paralelo
			const [bodyMesh, wheelMeshes] = await Promise.all([
				this.loadModel(vehicleConfig.body.modelPath, vehicleConfig.body.scale),
				this.loadWheelModels(
					vehicleConfig.wheels.modelPath,
					vehicleConfig.wheels.scale,
					wheelCount,
					vehicleConfig,
				),
			]);

			if (!bodyMesh) {
				return { body: this.createFallbackChassis(vehicleConfig), wheels: wheelMeshes };
			}

			this.setupBodyMesh(bodyMesh, vehicleConfig);

			return {
				body: bodyMesh,
				wheels: wheelMeshes,
			};
		} catch (error) {
			console.error("Erro ao carregar veículo:", error);
			return this.createFallbackVehicle(wheelCount, vehicleConfig);
		}
	}

	async loadModel(path: string, scale: { x: number; y: number; z: number }): Promise<THREE.Group | null> {
		try {
			return await this.modelLoader.loadModel(path, scale);
		} catch (error) {
			console.warn(`Falha ao carregar modelo ${path}:`, error);
			return null; // Fallback
		}
	}

	setupBodyMesh(bodyMesh: THREE.Object3D, _config: VehicleDefinition): void {
		bodyMesh.castShadow = true;
		bodyMesh.receiveShadow = true;

		// Configurar materiais
		bodyMesh.traverse((child: any) => {
			if (child.isMesh) {
				const childNameLower = child.name.toLowerCase();

				// Aplicar sobra em todos os meshes, exceto glass
				if (!childNameLower.includes("glass")) {
					child.castShadow = true;
					child.receiveShadow = true;
				}
			}
		});
	}

	async loadWheelModels(
		modelPath: string,
		scale: { x: number; y: number; z: number },
		wheelCount: number,
		vehicleConfig: VehicleDefinition,
	): Promise<THREE.Object3D[]> {
		const loaded = await Promise.all(Array.from({ length: wheelCount }, () => this.loadModel(modelPath, scale)));
		const wheelMeshes = loaded.filter((wheel): wheel is THREE.Group => wheel !== null);

		if (wheelMeshes.length < wheelCount) {
			console.error("Erro ao criar rodas: falha ao carregar modelo da roda");
			this.releaseObjects(wheelMeshes);
			return this.createFallbackWheels(wheelCount, vehicleConfig);
		}

		const adjustments = vehicleConfig.wheels.adjustments;
		wheelMeshes.forEach((wheelInstance, i) => {
			wheelInstance.castShadow = true;
			wheelInstance.receiveShadow = true;
			wheelInstance.traverse((child: any) => {
				if (child.isMesh) {
					child.castShadow = true;
					child.receiveShadow = true;
				}
			});

			if (adjustments[i]) {
				wheelInstance.position.set(
					adjustments[i].position.x,
					adjustments[i].position.y,
					adjustments[i].position.z,
				);
			}
		});

		return wheelMeshes;
	}

	createFallbackVehicle(wheelCount: number, vehicleConfig: VehicleDefinition): LoadedVehicle {
		return {
			body: this.createFallbackChassis(vehicleConfig),
			wheels: this.createFallbackWheels(wheelCount, vehicleConfig),
		};
	}

	createFallbackChassis(vehicleConfig: VehicleDefinition): THREE.Mesh {
		const chassisSize = vehicleConfig.physics.size;
		const chassisGeometry = new THREE.BoxGeometry(chassisSize.y, chassisSize.z, chassisSize.x);
		const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
		const chassisMesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		chassisMesh.castShadow = true;
		return chassisMesh;
	}

	createFallbackWheels(wheelCount: number, vehicleConfig: VehicleDefinition): THREE.Mesh[] {
		const radius = vehicleConfig.physics.wheelRadius;
		const wheelGeometry = new THREE.CylinderGeometry(radius, radius, 0.24, 32);
		const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0f0f });

		const wheelMeshes: THREE.Mesh[] = [];
		const adjustments = vehicleConfig.wheels.adjustments;

		for (let i = 0; i < wheelCount; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			wheelMesh.receiveShadow = true;

			// Posição inicial baseada nos ajustes
			if (adjustments[i]) {
				wheelMesh.position.set(adjustments[i].position.x, adjustments[i].position.y, adjustments[i].position.z);
			}

			wheelMeshes.push(wheelMesh);
		}

		return wheelMeshes;
	}
}
