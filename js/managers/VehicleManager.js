import * as THREE from "three";
import * as CANNON from "cannon-es";
import ModelLoader from "../loaders/ModelLoader";

/**
 * Gerenciador de veículos para carregamento e configuração
 */
class VehicleManager {
   constructor(scene, physicsManager) {
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
               tractionDisplacement: "all", // "front", "rear", "all"

               // Estado atual
               currentSteering: 0,
               currentSpeed: 0,
            },
            wheels: {
               modelPath: "/assets/models/wheel/rodas.gltf",
               scale: { x: 0.4, y: 0.4, z: 0.4 },
               adjustments: [
                  // (0: frontal esquerda, 1: frontal direita, 2: traseira esquerda, 3: traseira direita)
                  {
                     position: { x: 0.74, y: 0, z: -0.4 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
                  {
                     position: { x: 0.74, y: 0, z: 0.4 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
                  {
                     position: { x: -0.645, y: 0, z: -0.4 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
                  {
                     position: { x: -0.645, y: 0, z: 0.4 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
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
               suspensionRestLength: 0.285,
               frictionSlip: 2.5,
               maxSuspensionTravel: 0.2,
               dampingRelaxation: 2.3,
               dampingCompression: 4.5,
               rollInfluence: 0.1,
            },
            configs: {
               maxSpeed: 20,
               maxForce: 200,
               maxBoostForce: 3,
               boostForce: 1,
               brakeForce: 3,
               eBrakeForce: 7,
               maxSteerVal: 0.6,
               steerSpeed: 1.3,
               steerReturn: 2.0,
               tractionDisplacement: "rear", // "front", "rear", "all"
               
               // Estado atual
               currentSteering: 0,
               currentSpeed: 0,
            },
            wheels: {
               modelPath: "/assets/models/wheel/rodas.gltf",
               scale: { x: 0.4, y: 0.4, z: 0.4 },
               adjustments: [
                  {
                     // traseira direita
                     position: { x: 0.747, y: 0, z: -0.405 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
                  {
                     // traseira esquerda
                     position: { x: 0.747, y: 0, z: 0.405 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  },
                  {
                     // frontal direita
                     position: { x: -0.664, y: 0, z: -0.4 },
                     rotation: { x: Math.PI / 2, y: 0 , z: 0  },
                  },
                  {
                     // frontal esquerda
                     position: { x: -0.664, y: 0, z: 0.4 },
                     rotation: { x: Math.PI / 2, y: 0, z: 0 },
                  }
               ],
            },
         },
      };
   }

   /**
    * Carrega um veículo específico do catálogo
    * @param {String} vehicleId ID do veículo no catálogo
    * @param {CANNON.RaycastVehicle} vehicle Referência ao veículo CANNON
    * @returns {Promise<Object>} Objeto com meshes do carro e rodas
    */
   async loadVehicle(vehicleId, vehicle) {
      try {
         const vehicleConfig =
            this.vehicleCatalog[vehicleId] || this.vehicleCatalog.mercedes_g63;

         // Carregar modelo do corpo
         const bodyMesh = await this.loadModel(
            vehicleConfig.body.modelPath,
            vehicleConfig.body.scale
         );

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

   /**
    * Carrega um modelo 3D com tratamento de erro
    * @param {String} path Caminho do modelo
    * @param {Object} scale Escala do modelo
    * @returns {Promise<THREE.Group>} Modelo carregado
    */
   async loadModel(path, scale) {
      try {
         return await this.modelLoader.loadModel(path, scale);
      } catch (error) {
         console.warn(`Falha ao carregar modelo ${path}:`, error);
         return null; // Fallback
      }
   }

   /**
    * Configura o mesh do corpo do veículo
    * @param {THREE.Object3D} bodyMesh Mesh do corpo
    * @param {Object} config Configuração de materiais e propriedades
    */
   setupBodyMesh(bodyMesh, config) {
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;

      // Configurar materiais
      bodyMesh.traverse((child) => {
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

   /**
    * Carrega os modelos das rodas
    * @param {String} modelPath Caminho do modelo da roda
    * @param {Object} scale Escala da roda
    * @param {CANNON.RaycastVehicle} vehicle Veículo físico
    * @param {Array} adjustments Ajustes específicos por roda
    * @returns {Promise<Array<THREE.Object3D>>} Array de meshes das rodas
    */
   async loadWheelModels(modelPath, scale, vehicle, adjustments, vehicleId) {
      try {
         // Tentar carregar o modelo da roda
         const wheelModel = await this.loadModel(modelPath, scale);

         if (!wheelModel) {
            throw new Error("Falha ao carregar modelo da roda");
         }

         // Criar as quatro rodas
         const wheelMeshes = [];

         for (let i = 0; i < vehicle.wheelInfos.length; i++) {
            // Clonar o modelo base
            const wheelInstance = wheelModel.clone();
            wheelInstance.castShadow = true;
            wheelInstance.receiveShadow = true;

            // Ajustar materiais
            wheelInstance.traverse((child) => {
               if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
               }
            });

            // Atualizar a transformação da roda física
            vehicle.updateWheelTransform(i);
            const transform = vehicle.wheelInfos[i].worldTransform;

            // Aplicar a posição e rotação inicial da roda
            wheelInstance.position.copy(transform.position);
            wheelInstance.quaternion.copy(transform.quaternion);

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

   /**
    * Cria um veículo básico como fallback
    * @param {CANNON.RaycastVehicle} vehicle Veículo físico
    * @returns {Object} Objeto com meshes básicos
    */
   createFallbackVehicle(vehicle, vehicleId) {
      // Criar chassis básico
      const chassisSize = this.vehicleCatalog[vehicleId].physics.size;
      const chassisGeometry = new THREE.BoxGeometry(
         chassisSize.x,
         chassisSize.y,
         chassisSize.z
      );
      const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
      const chassisMesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
      chassisMesh.castShadow = true;

      // Adicionar marcador frontal
      const frontMarker = new THREE.Mesh(
         new THREE.BoxGeometry(0.1, 0.5, 1.3),
         new THREE.MeshStandardMaterial({ color: 0x3e7efa })
      );
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

   /**
    * Cria rodas básicas como fallback
    * @param {CANNON.RaycastVehicle} vehicle Veículo físico
    * @returns {Array<THREE.Mesh>} Array de meshes básicos de rodas
    */
   createFallbackWheels(vehicle, vehicleId) {
      const radius = this.vehicleCatalog[vehicleId].physics.wheelRadius;
      const wheelGeometry = new THREE.CylinderGeometry(radius, radius, 0.12, 32);
      // wheelGeometry.rotateX(Math.PI);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0f0f });

      
      const wheelMeshes = [];

      for (let i = 0; i < this.vehicleCatalog[vehicleId].wheels.adjustments.length; i++) {
         const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
         wheelMesh.castShadow = true;
         wheelMesh.receiveShadow = true;

         // Atualizar a transformação da roda física
         vehicle.updateWheelTransform(i);
         const transform = vehicle.wheelInfos[i].worldTransform;

         // Aplicar a posição e rotação inicial da roda
         wheelMesh.position.copy(transform.position);
         wheelMesh.quaternion.copy(transform.quaternion);

         this.scene.add(wheelMesh);
         wheelMeshes.push(wheelMesh);
      }

      return wheelMeshes;
   }
}

export default VehicleManager;
