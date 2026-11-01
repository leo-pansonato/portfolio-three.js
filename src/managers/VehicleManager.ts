import * as THREE from "three";
import ModelLoader from "../loaders/ModelLoader";

export enum CameraMode {
	THIRD_PERSON = "THIRD_PERSON",
	HOOD = "HOOD",
	FIRST_PERSON = "FIRST_PERSON",
}

export interface CameraConfig {
	distance: number; // Distancia atrás do carro
	height: number; // Altura relativa ao chão/carro
	fov: number; // Campo de visão
	lerpSpeed: number; // Quão rápido a camera segue (1 = instantaneo, 0.05 = pesado)
	lookAtOffset: { y: number, x?: number, z?: number }; // Para olhar um pouco acima do centro do carro
	offset?: { x: number; y: number; z: number }; // Ajuste fino para câmera de capô/interior
}

/**
 * Configuração de física do veículo para Rapier DynamicRayCastVehicleController
 */
export interface VehiclePhysicsConfig {
	/** Massa do chassi (kg) */
	mass: number;
	/** Collider do chassi (m): x comprimento (frente +X), y altura, z largura */
	size: { x: number; y: number; z: number };
	/** Raio das rodas (m) */
	wheelRadius: number;
	/** Rigidez da suspensão por kg de chassi (N/m/kg = 1/s²), modelo Bullet */
	suspensionStiffness: number;
	/** Comprimento de repouso da suspensão (m) */
	suspensionRestLength: number;
	/** Curso máximo a partir do repouso (m) */
	maxSuspensionTravel: number;
	/** Força máxima da suspensão por roda (N) */
	maxSuspensionForce: number;
	/** Amortecimento na compressão por kg de chassi (1/s) */
	suspensionCompression: number;
	/** Amortecimento na extensão por kg de chassi (1/s) */
	suspensionRelaxation: number;
	/** Limite de atrito do pneu (adimensional, multiplica a carga normal) */
	frictionSlip: number;
	/** Multiplicador do impulso lateral (adimensional) */
	sideFrictionStiffness: number;
}

// Interfaces para a configuração do veículo
export interface VehicleConfig {
	body: {
		modelPath: string;
		scale: { x: number; y: number; z: number };
		position: { x: number; y: number; z: number };
		rotation: { x: number; y: number; z: number };
		materials: any;
	};
	physics: VehiclePhysicsConfig;
	cameraSettings: {
		[CameraMode.THIRD_PERSON]: CameraConfig;
		[CameraMode.HOOD]: CameraConfig;
		[CameraMode.FIRST_PERSON]: CameraConfig;
	};
	/** Condução: maxForce, brakeForce, eBrakeForce e rollingResistance em N por roda; maxSteerVal rad */
	configs: any;
	wheels: {
		modelPath: string;
		scale: { x: number; y: number; z: number };
		/** Por roda: 0/1 dianteiras esquerda (-Z)/direita (+Z), 2/3 traseiras; posição local do chassi (frente +X) */
		adjustments: Array<{
			position: { x: number; y: number; z: number };
			rotation: { x: number; y: number; z: number };
         frictionSlip?: number;
         sideFrictionStiffness?: number;
		}>;
	};
}

export interface LoadedVehicle {
	body: THREE.Object3D | THREE.Mesh;
	wheels: THREE.Object3D[];
}

/**
 * Gerenciador de veículos para carregamento e configuração
 */
export default class VehicleManager {
	private scene: THREE.Scene;
	private modelLoader: ModelLoader;
	private vehicleCatalog: { [key: string]: VehicleConfig };

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.modelLoader = new ModelLoader();

		// Veículos disponíveis
		this.vehicleCatalog = {
			mercedes_g63: {
				body: {
					modelPath: "/assets/models/mercedes_g63/scene.gltf",
					scale: { x: 1, y: 1, z: 1 },
					position: { x: 0, y: -0.66, z: 0 },
					rotation: { x: 0, y: Math.PI / 2, z: 0 },
					materials: {
						body: {
							castShadow: false,
							receiveShadow: false,
						},
					},
				},
				physics: {
					mass: 2500,
					size: { x: 4.6, y: 1.2, z: 1.8 },
					wheelRadius: 0.38,
					suspensionStiffness: 25,
					suspensionRestLength: 0.8,
					maxSuspensionTravel: 0.8,
					maxSuspensionForce: 100000,
					suspensionCompression: 3.2,
					suspensionRelaxation: 1.6,
					frictionSlip: 1.4,
					sideFrictionStiffness: 1.0,
				},
				cameraSettings: {
					[CameraMode.THIRD_PERSON]: {
						distance: 5,
						height: 1.6,
						fov: 60,
						lerpSpeed: 0.1,
						lookAtOffset: { y: 1, x: 0, z: 0 },
					},
					[CameraMode.HOOD]: {
                  fov: 75,
						lerpSpeed: 0.2,
						offset: { x: 0, y: 1.08, z: 1.3 },
						distance: 0,
						height: 0,
						lookAtOffset: { y: 0 },
					},
					[CameraMode.FIRST_PERSON]: {
                  fov: 90,
						lerpSpeed: 0.3,
                  offset: { x: 0.4, y: 1.2, z: -0.16 },
						distance: 0,
						height: 0,
						lookAtOffset: { y: 0 },
					},
				},
				configs: {
					maxSpeed: 20,
					maxForce: 3500,
					maxBoostForce: 3,
					boostForce: 3,
					brakeForce: 5700,
					rollingResistance: 75,
					eBrakeForce: 3900,
					maxSteerVal: 0.5,
					steerSpeed: 2.0,
					steerReturn: 2.0,
					tractionDisplacement: "all",
					currentSteering: 0,
					currentSpeed: 0,
				},
				wheels: {
					modelPath: "/assets/models/wheel/scene.gltf",
					scale: { x: 1, y: 1, z: 1 },
					adjustments: [
						{ position: { x: 1.48, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: 1.48, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -1.29, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -1.29, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
					],
				},
			},
			bmw_f82: {
				body: {
					modelPath: "/assets/models/bmw_m4_f82/scene.gltf",
					scale: { x: 1, y: 1, z: 1 },
					position: { x: 0.2, y: -0.66, z: 0 },
					rotation: { x: 0, y: Math.PI / 2, z: 0 },
					materials: {
						glass: {
							castShadow: false,
							receiveShadow: false,
						},
					},
				},
				physics: {
					mass: 1550,
					size: { x: 4.6, y: 1.2, z: 1.8 },
					wheelRadius: 0.33,
					suspensionStiffness: 30,
					suspensionRestLength: 0.52,
					maxSuspensionTravel: 0.4,
					maxSuspensionForce: 100000,
					suspensionCompression: 3.2,
					suspensionRelaxation: 1.6,
					frictionSlip: 2.0,
					sideFrictionStiffness: 1.0,
				},
            cameraSettings: {
					[CameraMode.THIRD_PERSON]: {
						distance: 5,
						height: 1.6,
						fov: 60,
						lerpSpeed: 0.1,
						lookAtOffset: { y: 1, x: 0, z: 0 },
					},
					[CameraMode.HOOD]: {
                  fov: 80,
						lerpSpeed: 0.2,
						offset: { x: 0, y: 1, z: 1.3 },
						distance: 0,
						height: 0,
						lookAtOffset: { y: 0 },
					},
					[CameraMode.FIRST_PERSON]: {
                  fov: 70,
						lerpSpeed: 0.3,
                  offset: { x: 0.36, y: 1.04, z: -0.3 },
						distance: 0,
						height: 0,
						lookAtOffset: { y: 0 },
					},
				},
				configs: {
					maxSpeed: 20,
					maxForce: 5000,
					maxBoostForce: 3,
					boostForce: 1,
					brakeForce: 3600,
					rollingResistance: 93,
					eBrakeForce: 3300,
					maxSteerVal: 0.5,
					steerSpeed: 1.3,
					steerReturn: 2.0,
					tractionDisplacement: "rear",
					currentSteering: 0,
					currentSpeed: 0,
				},
				wheels: {
					modelPath: "/assets/models/wheel/scene.gltf",
					scale: { x: 0.85, y: 0.85, z: 0.85 },
					adjustments: [
						{ position: { x: 1.494, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: 1.494, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -1.328, y: 0, z: -0.81 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
						{ position: { x: -1.328, y: 0, z: 0.81 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
					],
				},
			},
		};
	}

	/**
	 * Carrega um veículo específico do catálogo
	 * @param vehicleId ID do veículo no catálogo
	 * @param wheelCount Número de rodas do veículo
	 */
	async loadVehicle(vehicleId: string, wheelCount: number = 4): Promise<LoadedVehicle> {
		try {
			const vehicleConfig = this.vehicleCatalog[vehicleId] || this.vehicleCatalog.mercedes_g63;

			// Carregar corpo e rodas em paralelo
			const [bodyMesh, wheelMeshes] = await Promise.all([
				this.loadModel(vehicleConfig.body.modelPath, vehicleConfig.body.scale),
				this.loadWheelModels(
					vehicleConfig.wheels.modelPath,
					vehicleConfig.wheels.scale,
					wheelCount,
					vehicleConfig.wheels.adjustments,
					vehicleId
				)
			]);

			if (!bodyMesh) {
				return { body: this.createFallbackChassis(vehicleId), wheels: wheelMeshes };
			}

			this.setupBodyMesh(bodyMesh, vehicleConfig);

			return {
				body: bodyMesh,
				wheels: wheelMeshes,
			};
		} catch (error) {
			console.error("Erro ao carregar veículo:", error);
			return this.createFallbackVehicle(wheelCount, vehicleId);
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

	setupBodyMesh(bodyMesh: THREE.Object3D, _config: VehicleConfig): void {
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
		adjustments: any[],
		vehicleId: string
	): Promise<THREE.Object3D[]> {
		try {
			// Tentar carregar o modelo da roda
			const wheelModel = await this.loadModel(modelPath, scale);

			if (!wheelModel) {
				throw new Error("Falha ao carregar modelo da roda");
			}

			// Criar as rodas
			const wheelMeshes: THREE.Object3D[] = [];

			for (let i = 0; i < wheelCount; i++) {
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

				// Posição inicial baseada nos ajustes (será atualizada pelo Player)
				if (adjustments[i]) {
					wheelInstance.position.set(
						adjustments[i].position.x,
						adjustments[i].position.y,
						adjustments[i].position.z
					);
				}

				// Adicionar à cena e ao array
				this.scene.add(wheelInstance);
				wheelMeshes.push(wheelInstance);
			}

			return wheelMeshes;
		} catch (error) {
			console.error("Erro ao criar rodas:", error);
			return this.createFallbackWheels(wheelCount, vehicleId);
		}
	}

	createFallbackVehicle(wheelCount: number, vehicleId: string): LoadedVehicle {
		return {
			body: this.createFallbackChassis(vehicleId),
			wheels: this.createFallbackWheels(wheelCount, vehicleId),
		};
	}

	createFallbackChassis(vehicleId: string): THREE.Mesh {
		const chassisSize = this.vehicleCatalog[vehicleId]?.physics?.size || { x: 4.6, y: 1.2, z: 1.8 };
		const chassisGeometry = new THREE.BoxGeometry(chassisSize.y, chassisSize.z, chassisSize.x);
		const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
		const chassisMesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		chassisMesh.castShadow = true;
		return chassisMesh;
	}

	createFallbackWheels(wheelCount: number, vehicleId: string): THREE.Mesh[] {
		const radius = this.vehicleCatalog[vehicleId]?.physics?.wheelRadius || 0.38;
		const wheelGeometry = new THREE.CylinderGeometry(radius, radius, 0.24, 32);
		const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0f0f });

		const wheelMeshes: THREE.Mesh[] = [];
		const adjustments = this.vehicleCatalog[vehicleId]?.wheels?.adjustments || [];

		for (let i = 0; i < wheelCount; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			wheelMesh.receiveShadow = true;

			// Posição inicial baseada nos ajustes
			if (adjustments[i]) {
				wheelMesh.position.set(
					adjustments[i].position.x,
					adjustments[i].position.y,
					adjustments[i].position.z
				);
			}

			this.scene.add(wheelMesh);
			wheelMeshes.push(wheelMesh);
		}

		return wheelMeshes;
	}

   getVehicleConfig(vehicleId: string): VehicleConfig | null {
      return this.vehicleCatalog[vehicleId] || null;
   }

}
