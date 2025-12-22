import * as THREE from "three";
import * as CANNON from "cannon-es";
import ModelLoader from "../loaders/ModelLoader";
import PhysicsManager from "./PhysicsManager";

// Interfaces para a configuração do veículo
interface VehicleConfig {
	body: {
		modelPath: string;
		scale: { x: number; y: number; z: number };
		position: { x: number; y: number; z: number };
		rotation: { x: number; y: number; z: number };
		materials: any;
	};
	physics: {
		mass: number;
		size: { x: number; y: number; z: number };
		wheelRadius: number;
		suspensionStiffness: number;
		suspensionRestLength: number;
		frictionSlip: number;
		maxSuspensionTravel: number;
		dampingRelaxation: number;
		dampingCompression: number;
		rollInfluence: number;
	};
	configs: any;
	wheels: {
		modelPath: string;
		scale: { x: number; y: number; z: number };
		adjustments: Array<{
			position: { x: number; y: number; z: number };
			rotation: { x: number; y: number; z: number };
		}>;
	};
}

interface LoadedVehicle {
	body: THREE.Object3D | THREE.Mesh;
	wheels: THREE.Object3D[];
}

/**
 * Gerenciador de veículos para carregamento e configuração
 */
export default class VehicleManager {
	private scene: THREE.Scene;
	private physicsManager: PhysicsManager;
	private modelLoader: ModelLoader;
	private vehicleCatalog: { [key: string]: VehicleConfig };

	constructor(scene: THREE.Scene, physicsManager: PhysicsManager) {
		this.scene = scene;
		this.physicsManager = physicsManager;
		this.modelLoader = new ModelLoader();

		// Veículos disponíveis
		this.vehicleCatalog = {
			mercedes_g63: {
				body: {
					modelPath: "/assets/models/mercedes_g63/car.gltf",
					scale: { x: 0.5, y: 0.5, z: 0.5 },
					position: { x: 0, y: -0.33, z: 0 },
					rotation: { x: 0, y: Math.PI / 2, z: 0 },
					materials: {
						body: {
							castShadow: false,
							receiveShadow: false,
						},
					},
				},
				physics: {
					mass: 400,
					size: { x: 2.3, y: 0.6, z: 0.9 },
					wheelRadius: 0.19,
					suspensionStiffness: 50,
					suspensionRestLength: 0.4,
					frictionSlip: 1.8,
					maxSuspensionTravel: 0.4,
					dampingRelaxation: 2.3,
					dampingCompression: 4.5,
					rollInfluence: 0.3,
				},
				configs: {
					maxSpeed: 20,
					maxForce: 400,
					maxBoostForce: 3,
					boostForce: 3,
					brakeForce: 5,
					eBrakeForce: 10,
					maxSteerVal: 0.5,
					steerSpeed: 2.0,
					steerReturn: 2.0,
					tractionDisplacement: "all",
					currentSteering: 0,
					currentSpeed: 0,
				},
				wheels: {
					modelPath: "/assets/models/wheel2/rodass.gltf",
					scale: { x: 0.5, y: 0.5, z: 0.5 },
					adjustments: [
						{ position: { x: 0.74, y: 0, z: -0.4 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: 0.74, y: 0, z: 0.4 }, rotation: { x: Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -0.645, y: 0, z: -0.4 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -0.645, y: 0, z: 0.4 }, rotation: { x: Math.PI / 2, y: 0, z: Math.PI / 2 } },
					],
				},
			},
			bmw_f82: {
				body: {
					modelPath: "/assets/models/bmw_m4_f82/bmw_m4_f82.gltf",
					scale: { x: 0.5, y: 0.5, z: 0.5 },
					position: { x: 0.1, y: -0.33, z: 0 },
					rotation: { x: 0, y: Math.PI / 2, z: 0 },
					materials: {
						glass: {
							castShadow: false,
							receiveShadow: false,
						},
					},
				},
				physics: {
					mass: 200,
					size: { x: 2.3, y: 0.6, z: 0.9 },
					wheelRadius: 0.165,
					suspensionStiffness: 60,
					suspensionRestLength: 0.26,
					frictionSlip: 2.5,
					maxSuspensionTravel: 0.2,
					dampingRelaxation: 2.3,
					dampingCompression: 4.5,
					rollInfluence: 0.1,
				},
				configs: {
					maxSpeed: 20,
					maxForce: 300,
					maxBoostForce: 3,
					boostForce: 1,
					brakeForce: 5,
					eBrakeForce: 7,
					maxSteerVal: 0.5,
					steerSpeed: 1.3,
					steerReturn: 2.0,
					tractionDisplacement: "rear",
					currentSteering: 0,
					currentSpeed: 0,
				},
				wheels: {
					modelPath: "/assets/models/wheel2/rodass.gltf",
					scale: { x: 0.425, y: 0.425, z: 0.425 },
					adjustments: [
						{ position: { x: 0.747, y: 0, z: -0.4 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: 0.747, y: 0, z: 0.4 }, rotation: { x: Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -0.664, y: 0, z: -0.405 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -0.664, y: 0, z: 0.4 }, rotation: { x: Math.PI / 2, y: 0, z: Math.PI / 2 } },
					],
				},
			},
		};
	}

	/**
	 * Carrega um veículo específico do catálogo
	 */
	async loadVehicle(vehicleId: string, vehicle: CANNON.RaycastVehicle): Promise<LoadedVehicle> {
		try {
			const vehicleConfig = this.vehicleCatalog[vehicleId] || this.vehicleCatalog.mercedes_g63;

			// Carregar modelo do corpo
			const bodyMesh = await this.loadModel(vehicleConfig.body.modelPath, vehicleConfig.body.scale);

			if (!bodyMesh) {
				throw new Error("Falha ao carregar modelo do corpo");
			}

			// Configurar o modelo do corpo
			if (bodyMesh) {
				this.setupBodyMesh(bodyMesh, vehicleConfig.body);
			}

			// Carregar modelos das rodas
			const wheelMeshes = await this.loadWheelModels(
				vehicleConfig.wheels.modelPath,
				vehicleConfig.wheels.scale,
				vehicle,
				vehicleConfig.wheels.adjustments,
				vehicleId
			);

			return {
				body: bodyMesh,
				wheels: wheelMeshes,
			};
		} catch (error) {
			console.error("Erro ao carregar veículo:", error);
			return this.createFallbackVehicle(vehicle, vehicleId);
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

	setupBodyMesh(bodyMesh: THREE.Object3D, config: any): void {
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
		vehicle: CANNON.RaycastVehicle,
		adjustments: any[],
		vehicleId: string
	): Promise<THREE.Object3D[]> {
		try {
			// Tentar carregar o modelo da roda
			const wheelModel = await this.loadModel(modelPath, scale);

			if (!wheelModel) {
				throw new Error("Falha ao carregar modelo da roda");
			}

			// Criar as quatro rodas
			const wheelMeshes: THREE.Object3D[] = [];

			for (let i = 0; i < vehicle.wheelInfos.length; i++) {
				// Clonar o modelo base
				const wheelInstance = wheelModel.clone();
				wheelInstance.castShadow = true;
				wheelInstance.receiveShadow = true;

				// Ajustar materiais
				wheelInstance.traverse((child: any) => {
					if (child.isMesh) {
						child.castShadow = true;
						child.receiveShadow = true;
					}
				});

				// Atualizar a transformação da roda física
				vehicle.updateWheelTransform(i);
				const transform = vehicle.wheelInfos[i].worldTransform;

				// Aplicar a posição e rotação inicial da roda
				wheelInstance.position.copy(transform.position as unknown as THREE.Vector3);
				wheelInstance.quaternion.copy(transform.quaternion as unknown as THREE.Quaternion);

				// Adicionar à cena e ao array
				this.scene.add(wheelInstance);
				wheelMeshes.push(wheelInstance);
			}

			return wheelMeshes;
		} catch (error) {
			console.error("Erro ao criar rodas:", error);
			return this.createFallbackWheels(vehicle, vehicleId);
		}
	}

	createFallbackVehicle(vehicle: CANNON.RaycastVehicle, vehicleId: string): LoadedVehicle {
		// Criar chassis básico
		const chassisSize = this.vehicleCatalog[vehicleId].physics.size;
		const chassisGeometry = new THREE.BoxGeometry(chassisSize.x, chassisSize.y, chassisSize.z);
		const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
		const chassisMesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		chassisMesh.castShadow = true;

		// Adicionar marcador frontal
		const frontMarker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.3), new THREE.MeshStandardMaterial({ color: 0x3e7efa }));
		frontMarker.position.x = 2;
		frontMarker.position.y = 0.5;
		chassisMesh.add(frontMarker);

		// Criar rodas básicas
		const wheelMeshes = this.createFallbackWheels(vehicle, vehicleId);

		return {
			body: chassisMesh,
			wheels: wheelMeshes,
		};
	}

	createFallbackWheels(vehicle: CANNON.RaycastVehicle, vehicleId: string): THREE.Mesh[] {
		const radius = this.vehicleCatalog[vehicleId].physics.wheelRadius;
		const wheelGeometry = new THREE.CylinderGeometry(radius, radius, 0.12, 32);
		// wheelGeometry.rotateX(Math.PI);
		const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0f0f });

		const wheelMeshes: THREE.Mesh[] = [];

		for (let i = 0; i < this.vehicleCatalog[vehicleId].wheels.adjustments.length; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			wheelMesh.receiveShadow = true;

			// Atualizar a transformação da roda física
			vehicle.updateWheelTransform(i);
			const transform = vehicle.wheelInfos[i].worldTransform;

			// Aplicar a posição e rotação inicial da roda
			// Casting necessario pois Cannon Types as vezes diferem ligeiramente de Three Types
			wheelMesh.position.copy(transform.position as unknown as THREE.Vector3);
			wheelMesh.quaternion.copy(transform.quaternion as unknown as THREE.Quaternion);

			this.scene.add(wheelMesh);
			wheelMeshes.push(wheelMesh);
		}

		return wheelMeshes;
	}
}
