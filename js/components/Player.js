import * as THREE from "three";
import * as CANNON from "cannon-es";
import Entity from "./Entity";
import ModelLoader from "../loaders/ModelLoader";
import VehicleManager from "../managers/VehicleManager";

/**
 * Player jogável usando RaycastVehicle do Cannon.js
 */
class Player extends Entity {
   constructor(scene, inputManager, physicsManager) {
      super(scene);
      this.inputManager = inputManager;
      this.physicsManager = physicsManager;
      this.modelLoader = new ModelLoader();
      this.vehicleManager = new VehicleManager(scene, physicsManager);

      // ID do veículo atual
      this.currentVehicleId = "bmw_f82"; // bmw_f82 / mercedes_g63
      this.vehicleData = {};

      // Inicializar a configuração do veículo
      this.initVehicleConfigs();

      // Inicializar o veículo físico
      this.initPhysics();

      // Inicializar o veículo visual
      this.initVisuals();

      // Adicionar veiculo à cena
      this.addToScene();

      // Carregar o modelo do veículo
      this.loadVehicle(this.currentVehicleId);

      // Inicializar a visualização dos raycasts de suspensão
      // this.initSuspensionRaycastVisualizer();
   }

   initVehicleConfigs() {
      this.vehicleData = this.vehicleManager.vehicleCatalog[this.currentVehicleId];
   }

   /**
    * Inicializar o veículo físico
    */
   initPhysics() {
      // Criar o chassi do veículo
      const physicsData = this.vehicleData.physics;
      const chassisSize = physicsData.size;

      // Criar o corpo físico
      const chassisShape = new CANNON.Box(
         new CANNON.Vec3(chassisSize.x / 2, chassisSize.y / 2, chassisSize.z / 2)
      );
      this.chassisBody = new CANNON.Body({ mass: physicsData.mass });
      this.chassisBody.addShape(chassisShape);
      this.chassisBody.position.set(0, 1, 3);
      this.chassisBody.angularVelocity.set(0, 0, 0);

      // Configurar e criar o veículo
      this.setupVehicle(this.vehicleData);
   }

   /**
    * Configurar o veículo físico com as rodas
    * @param {Object} vehicleData Dados físicos do veículo
    */
   setupVehicle(vehicleData) {
      const physicsData = vehicleData.physics;
      // Criar o veículo raycast
      this.vehicle = new CANNON.RaycastVehicle({
         chassisBody: this.chassisBody,
      });

      // Opções das rodas
      const options = {
         radius: physicsData.wheelRadius,
         directionLocal: new CANNON.Vec3(0, -1, 0),
         chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
         axleLocal: new CANNON.Vec3(0, 0, 1),
         suspensionStiffness: physicsData.suspensionStiffness,
         suspensionRestLength: physicsData.suspensionRestLength,
         maxSuspensionTravel: physicsData.maxSuspensionTravel,
         dampingCompression: physicsData.dampingCompression,
         dampingRelaxation: physicsData.dampingRelaxation,
         rollInfluence: physicsData.rollInfluence,
         maxSuspensionForce: 100000,
         frictionSlip: physicsData.frictionSlip,
         customSlidingRotationalSpeed: 20,
         useCustomSlidingRotationalSpeed: true,
      };

      // Adicionar as rodas
      for (let i = 0; i < vehicleData.wheels.adjustments.length; i++) {
         options.chassisConnectionPointLocal.set(
            vehicleData.wheels.adjustments[i].position.x,
            vehicleData.wheels.adjustments[i].position.y,
            vehicleData.wheels.adjustments[i].position.z
         );
         this.vehicle.addWheel(options);
      }

      // Adicionar o veículo ao mundo físico
      this.vehicle.addToWorld(this.physicsManager.world);
   }

   /**
    * Inicializar os elementos visuais do veículo
    */
   initVisuals() {
      // Criar mesh básica de placeholder
      const chassisSize = this.vehicleData.physics.size;
      const chassisGeometry = new THREE.BoxGeometry(
         chassisSize.x,
         chassisSize.y,
         chassisSize.z
      );
      const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
      this.mesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
      this.mesh.castShadow = true;

      // Criar mesh básica para as rodas
      this.wheelMeshes = [];
      const wheelRadius = this.vehicleData.physics.wheelRadius;
      const wheelGeometry = new THREE.CylinderGeometry(
         wheelRadius,
         wheelRadius,
         0.15,
         32
      );
      wheelGeometry.rotateX(Math.PI / 2);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

      for (let i = 0; i < 4; i++) {
         const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
         wheelMesh.castShadow = true;
         this.scene.add(wheelMesh);
         this.wheelMeshes.push(wheelMesh);
      }

      // Guardar referência à mesh original
      this.originalMesh = this.mesh;

      // Adicionar o chassi ao gerenciador de física
      this.physicsManager.addBody(this.chassisBody, this.mesh);
   }

   /**
    * Carregar um veículo específico
    * @param {String} vehicleId ID do veículo no catálogo
    */
   async loadVehicle(vehicleId) {
      try {
         console.log(`Carregando veículo: ${vehicleId}`);

         // Carregar os novos modelos
         const vehicleModels = await this.vehicleManager.loadVehicle(
            vehicleId,
            this.vehicle
         );

         // Remover o modelo atual da cena
         this.scene.remove(this.mesh);

         // Remover as rodas atuais da cena
         this.wheelMeshes.forEach((wheel) => {
            if (wheel.parent) {
               this.scene.remove(wheel);
            }
         });

         // Atualizar a referência ao modelo do chassi
         if (vehicleModels.body) {
            this.mesh = vehicleModels.body;
            this.scene.add(this.mesh);
         }

         // Atualizar as referências às rodas
         if (vehicleModels.wheels) {
            this.wheelMeshes = vehicleModels.wheels;
         }

         // Atualizar o ID atual
         this.currentVehicleId = vehicleId;
      } catch (error) {
         console.error(`Erro ao carregar veículo ${vehicleId}:`, error);
      }
   }

   /**
    * Atualizar a física e a visualização do veículo
    * @param {Number} deltaTime Delta de tempo desde o último frame
    */
   update(deltaTime) {
      // Limitar o delta time para evitar problemas com FPS baixo
      const timeStep = Math.min(deltaTime, 1 / 30);

      // Atualizar a direção (volante)
      this.updateSteering(timeStep);

      // Atualizar aceleração e frenagem
      this.updateDriving(timeStep);

      // Atualizar o modelo visual do chassi
      this.updateChassisMesh();

      // Atualizar os modelos visuais das rodas
      this.updateWheelMeshes();

      // Atualizar a visualização dos raycasts de suspensão
      // this.updateSuspensionRaycastVisualizer();
   }

   /**
    * Atualizar a direção do veículo (volante)
    * @param {Number} timeStep Delta de tempo limitado
    */
   updateSteering(timeStep) {
      // Determinar o valor alvo para a direção
      let targetSteering = 0;
      if (this.inputManager.isKeyPressed("arrowleft")) {
         targetSteering = this.vehicleData.configs.maxSteerVal;
      } else if (this.inputManager.isKeyPressed("arrowright")) {
         targetSteering = -this.vehicleData.configs.maxSteerVal;
      }

      // Ajustar a resposta da direção com base na velocidade
      const speedFactor = Math.min(
         Math.abs(this.vehicleData.configs.currentSpeed) / 100,
         1
      );
      const effectiveSteerSpeed =
         this.vehicleData.configs.steerSpeed * (1 - speedFactor * 0.5);
      const effectiveReturnSpeed =
         this.vehicleData.configs.steerReturn * (1 + speedFactor * 0.5);

      // Movimento gradual do volante
      if (targetSteering !== 0) {
         // Movimento em direção ao valor alvo
         if (this.vehicleData.configs.currentSteering < targetSteering) {
            this.vehicleData.configs.currentSteering += effectiveSteerSpeed * timeStep;
            if (this.vehicleData.configs.currentSteering > targetSteering) {
               this.vehicleData.configs.currentSteering = targetSteering;
            }
         } else if (this.vehicleData.configs.currentSteering > targetSteering) {
            this.vehicleData.configs.currentSteering -= effectiveSteerSpeed * timeStep;
            if (this.vehicleData.configs.currentSteering < targetSteering) {
               this.vehicleData.configs.currentSteering = targetSteering;
            }
         }
      } else {
         // Retorno automático para centro
         if (
            Math.abs(this.vehicleData.configs.currentSteering) <
            effectiveReturnSpeed * timeStep
         ) {
            this.vehicleData.configs.currentSteering = 0;
         } else if (this.vehicleData.configs.currentSteering > 0) {
            this.vehicleData.configs.currentSteering -= effectiveReturnSpeed * timeStep;
         } else if (this.vehicleData.configs.currentSteering < 0) {
            this.vehicleData.configs.currentSteering += effectiveReturnSpeed * timeStep;
         }
      }

      // Aplicar a direção às rodas dianteiras
      this.vehicle.setSteeringValue(this.vehicleData.configs.currentSteering, 0);
      this.vehicle.setSteeringValue(this.vehicleData.configs.currentSteering, 1);
   }

   /**
    * Atualizar aceleração, frenagem e tração do veículo
    * @param {Number} timeStep Delta de tempo
    */
   updateDriving(timeStep) {
      // Calcular a velocidade atual
      const velocity = this.vehicle.chassisBody.velocity;
      const chassisForward = new CANNON.Vec3();
      this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), chassisForward);
      this.vehicleData.configs.currentSpeed = velocity.dot(chassisForward);

      // Flag para marchas
      const isAlmostStopped = this.vehicleData.configs.currentSpeed > -2.0;

      // Inicializar forças
      let engineForce = 0;
      let brakeForce = 0;
      let handbrakeForce = 0;

      // Verificar inputs
      const accelerating = this.inputManager.isKeyPressed("arrowup");
      const braking = this.inputManager.isKeyPressed("arrowdown");
      const handbraking = this.inputManager.isKeyPressed(" ");
      const boosting = this.inputManager.isKeyPressed("shift");

      // Gerenciar boost
      if (boosting) {
         this.vehicleData.configs.boostForce = this.vehicleData.configs.maxBoostForce;
      } else {
         this.vehicleData.configs.boostForce = 1;
      }
      
      
      // Determinar força do motor
      if (accelerating) {
         engineForce = this.vehicleData.configs.maxForce;
      }

      // Gerenciar frenagem e marcha-ré
      if (braking) {
         if (isAlmostStopped && !accelerating) {
            // Marcha-ré
            engineForce = -this.vehicleData.configs.maxForce;
         } else {
            // Frenagem normal
            brakeForce = this.vehicleData.configs.brakeForce;
         }
      }

      // Freio de mão
      if (handbraking) {
         handbrakeForce = this.vehicleData.configs.eBrakeForce;
      }

      // Aplicar boost
      engineForce *= this.vehicleData.configs.boostForce;

      // Aplicar força do motor conforme configuração de tração
      this.applyEngineForce(engineForce);

      // Aplicar frenagem
      this.applyBraking(brakeForce, handbrakeForce);
   }

   /**
    * Aplicar a força do motor com base no tipo de tração
    * @param {Number} force Força a ser aplicada
    */
   applyEngineForce(force) {
      switch (this.vehicleData.configs.tractionDisplacement) {
         case "rear":
            // Tração traseira
            this.vehicle.applyEngineForce(force, 2); // Traseira esquerda
            this.vehicle.applyEngineForce(force, 3); // Traseira direita
            break;
         case "front":
            // Tração dianteira
            this.vehicle.applyEngineForce(force, 0); // Frontal esquerda
            this.vehicle.applyEngineForce(force, 1); // Frontal direita
            break;
         case "all":
         default:
            // Tração integral
            this.vehicle.applyEngineForce(force, 0); // Frontal esquerda
            this.vehicle.applyEngineForce(force, 1); // Frontal direita
            this.vehicle.applyEngineForce(force, 2); // Traseira esquerda
            this.vehicle.applyEngineForce(force, 3); // Traseira direita
            break;
      }
   }

   /**
    * Aplicar frenagem ao veículo
    * @param {Number} normalBrake Força de frenagem normal
    * @param {Number} handBrake Força do freio de mão
    */
   applyBraking(normalBrake, handBrake) {
      // Frear rodas dianteiras (com freio normal)
      this.vehicle.setBrake(normalBrake, 0); // Frontal esquerda
      this.vehicle.setBrake(normalBrake, 1); // Frontal direita

      // Frear rodas traseiras (com handbrake se ativado)
      const rearBrakeForce = handBrake > 0 ? handBrake : normalBrake;
      this.vehicle.setBrake(rearBrakeForce, 2); // Traseira esquerda
      this.vehicle.setBrake(rearBrakeForce, 3); // Traseira direita
   }

   /**
    * Atualizar o modelo visual do chassi
    */
   updateChassisMesh() {
      if (this.mesh && this.mesh !== this.originalMesh) {
         // Obter a configuração de alinhamento do veículo atual
         const chassisTransform = this.chassisBody;
         const chassisAdjustment = this.vehicleData?.body || null;

         // Aplicar a transformação e ajustes à mesh do chassi
         this.fixCarAlignment(this.mesh, chassisTransform, chassisAdjustment);
      }
   }

   /**
    * Atualizar os modelos visuais das rodas
    */
   updateWheelMeshes() {
      for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
         // Atualizar transformação física da roda
         this.vehicle.updateWheelTransform(i);
         const wheelTransform = this.vehicle.wheelInfos[i].worldTransform;

         const wheelAdjustment = this.vehicleData?.wheels?.adjustments?.[i] || null;

         // Aplicar a transformação e ajustes à mesh da roda
         this.fixWheelAlignment(i, this.wheelMeshes[i], wheelTransform, wheelAdjustment);
      }
   }

   /**
    * Fixa o alinhamento do chassi
    * @param {THREE.Object3D} carMesh Mesh do veículo
    * @param {Object} chassisTransform Chassi físico
    * @param {Object} adjustments Ajustes específicos para este chassi
    */
   fixCarAlignment(carMesh, chassisTransform, adjustments) {
      // Copiar a posição e rotação do corpo físico
      carMesh.position.copy(chassisTransform.position);
      carMesh.quaternion.copy(chassisTransform.quaternion);

      if (adjustments) {
         // Ajuste de posição
         if (adjustments.position) {
            const localOffset = new THREE.Vector3(
               adjustments.position.x,
               adjustments.position.y,
               adjustments.position.z
            );
            localOffset.applyQuaternion(chassisTransform.quaternion);
            carMesh.position.add(localOffset);
         }

         // Ajuste de rotação
         if (adjustments.rotation) {
            carMesh.rotateX(adjustments.rotation.x);
            carMesh.rotateY(adjustments.rotation.y);
            carMesh.rotateZ(adjustments.rotation.z);
         }
      }
   }

   /**
    * Corrige o alinhamento de uma roda específica
    * @param {Number} wheelIndex Índice da roda (0-3)
    * @param {THREE.Object3D} wheelMesh Mesh da roda
    * @param {Object} wheelTransform Transform da roda física
    * @param {Object} adjustments Ajustes específicos para esta roda
    */
   fixWheelAlignment(wheelIndex, wheelMesh, wheelTransform, adjustments) {
      // Resetar rotações da roda para aplicar na ordem correta
      // wheelMesh.rotation.set(0, 0, 0);

      // Copiar a posição do corpo físico
      wheelMesh.position.copy(wheelTransform.position);

      // Copiar a rotação do corpo físico
      wheelMesh.quaternion.copy(wheelTransform.quaternion);

      // Espelhar as rodas do lado direito (impares)
      if (wheelIndex % 2 === 1) {
         // wheelMesh.rotateY(Math.PI);
      }

      if (adjustments) {
         // Ajuste de rotação adicional
         if (adjustments.rotation) {
            wheelMesh.rotateX(adjustments.rotation.x);
            wheelMesh.rotateY(adjustments.rotation.y);
            wheelMesh.rotateZ(adjustments.rotation.z);
         }
      }
   }

   /**
    * Inicializa a visualização dos raycasts de suspensão
    */
   initSuspensionRaycastVisualizer() {
      // Criar linhas para representar os raycasts
      this.suspensionRays = [];
      const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

      for (let i = 0; i < 4; i++) {
         // Criar geometria de linha (será atualizada a cada frame)
         const geometry = new THREE.BufferGeometry();
         const positions = new Float32Array(2 * 3); // 2 pontos, 3 coordenadas por ponto
         geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

         // Criar a linha e adicionar à cena
         const line = new THREE.Line(geometry, material);
         this.scene.add(line);
         this.suspensionRays.push(line);
      }

      // Flag para controlar a visualização
      this.showSuspensionRays = true;
   }

   /**
    * Atualiza a visualização dos raycasts de suspensão
    */
   updateSuspensionRaycastVisualizer() {
      // Se a visualização estiver desativada, sair da função
      if (!this.showSuspensionRays) return;

      // Atualizar cada linha de raycast
      for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
         const wheelInfo = this.vehicle.wheelInfos[i];
         const ray = this.suspensionRays[i];

         // Obter o ponto de conexão da roda no espaço mundial
         const connectionPoint = new CANNON.Vec3();
         this.vehicle.chassisBody.pointToWorldFrame(
            wheelInfo.chassisConnectionPointLocal,
            connectionPoint
         );

         // Calcular a direção do raycast no espaço mundial
         const direction = new CANNON.Vec3();
         this.vehicle.chassisBody.vectorToWorldFrame(wheelInfo.directionLocal, direction);

         // Normalizar e escalar a direção pelo comprimento máximo da suspensão
         direction.normalize();
         const maxLength = wheelInfo.suspensionRestLength + wheelInfo.maxSuspensionTravel;
         direction.scale(maxLength, direction);

         // Calcular o ponto final do raycast
         const endPoint = new CANNON.Vec3();
         endPoint.copy(connectionPoint);
         endPoint.vadd(direction, endPoint);

         // Atualizar a geometria da linha
         const positions = ray.geometry.attributes.position.array;

         // Ponto inicial (conexão com o chassi)
         positions[0] = connectionPoint.x;
         positions[1] = connectionPoint.y;
         positions[2] = connectionPoint.z;

         // Ponto final (comprimento total do raycast)
         positions[3] = endPoint.x;
         positions[4] = endPoint.y;
         positions[5] = endPoint.z;

         // Marcar a geometria para atualização
         ray.geometry.attributes.position.needsUpdate = true;
      }
   }

   /**
    * Alterar o veículo atual
    * @param {String} vehicleId ID do novo veículo
    */
   changeVehicle(vehicleId) {
      if (!this.vehicleManager.vehicleCatalog[vehicleId]) {
         console.error(`Veículo ${vehicleId} não encontrado no catálogo`);
         return false;
      }

      this.vehicle.removeFromWorld(this.physicsManager.world);
      this.removeFromScene();
      this.wheelMeshes.forEach((wheel) => {
         if (wheel.parent) {
            this.scene.remove(wheel);
         }
      });

      this.currentVehicleId = vehicleId;
      this.initVehicleConfigs();
      this.initPhysics();

      return this.loadVehicle(vehicleId);
   }

   /**
    * Obter a velocidade atual do veículo
    * @returns {Number} Velocidade atual
    */
   getCurrentSpeed() {
      return this.vehicleData.configs.currentSpeed * 3.6 * -1;
   }

   /**
    * Obter o ângulo atual do volante
    * @returns {Number} Ângulo em graus
    */
   getWheelAngle() {
      return this.vehicle.wheelInfos[0].steering * (180 / Math.PI);
   }

   getMovimentDirection() {
      const direction = new CANNON.Vec3(0, 0, 0);
      this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), direction);
      return direction;
   }
}

export default Player;
