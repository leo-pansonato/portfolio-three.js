import * as THREE from "three";
import * as CANNON from "cannon-es";
import Entity from "./Entity";
import ModelLoader from "../loaders/ModelLoader";

/**
 * Player jogável usando RaycastVehicle do Cannon.js
 */
class Player extends Entity {
   constructor(scene, inputManager, physicsManager) {
      super(scene);
      this.inputManager = inputManager;
      this.physicsManager = physicsManager;
      this.modelLoader = new ModelLoader();

      // Configurações do veículo
      this.maxSpeed = 20; // Velocidade máxima do veículo
      this.maxForce = 400; // Força máxima do motor
      this.maxBoostForce = 1.5; // Força máxima do boost
      this.boostForce = 1; // Força do boost
      this.brakeForce = 5; // Força de frenagem
      this.eBrakeForce = 10; // Força do freio de estacionamento
      this.maxSteerVal = 0.5; // Ângulo máximo de esterçamento
      this.steerSpeed = 2.0; // Velocidade de esterçamento (quanto maior, mais rápido)
      this.steerReturn = 2.0; // Velocidade de retorno do volante (quanto maior, mais rápido)
      this.tractionDisplacement = "all"; // Tração traseira, dianteira ou integral (front|rear|all)

      // Estado atual do veículo
      this.currentSteering = 0;
      this.currentSpeed = 0;

      // Inicializa o veículo
      this.initialize();
      this.addToScene();

      // Carregar o modelo 3D
      this.loadCarModel();
   }

   initialize() {
      // Criar o chassi do veículo
      const chassisSize = { x: 4.2, y: 1, z: 1.7 };

      const chassisShape = new CANNON.Box(
         new CANNON.Vec3(chassisSize.x / 2, chassisSize.y / 2, chassisSize.z / 2)
      ); // Metade por causa da fisica do cannon
      this.chassisBody = new CANNON.Body({ mass: 150 });
      this.chassisBody.addShape(chassisShape);
      this.chassisBody.position.set(0, 1, 0);
      this.chassisBody.angularVelocity.set(0, 0, 0);

      // Configuração visual do chassi
      const chassisGeometry = new THREE.BoxGeometry(
         chassisSize.x,
         chassisSize.y,
         chassisSize.z
      );
      const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
      this.mesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
      this.mesh.castShadow = true;

      // Criar o marcador frontal
      const frontMarker = new THREE.Mesh(
         new THREE.BoxGeometry(0.1, 0.5, 1.3),
         new THREE.MeshStandardMaterial({ color: 0x3e7efa })
      );
      frontMarker.position.x = -1.5; // Frente do carro
      frontMarker.position.y = 0.15; // Altura do carro
      this.mesh.add(frontMarker);

      // Opções das rodas
      const options = {
         radius: 0.35,
         directionLocal: new CANNON.Vec3(0, -1, 0), // Direção da suspensão
         suspensionStiffness: 50, // Rigidez da suspensão
         suspensionRestLength: 0.6, // Comprimento de descanso da suspensão
         frictionSlip: 2, // Quanto a roda pode derrapar
         dampingRelaxation: 2.3, // Amortecimento de relaxamento
         dampingCompression: 4.5, // Amortecimento de compressão
         maxSuspensionForce: 100000, // Força máxima da suspensão
         rollInfluence: 0.2, // Influência na rolagem do veículo
         axleLocal: new CANNON.Vec3(0, 0, 1), // Eixo local da roda
         chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1), // Ponto de conexão com o chassi
         maxSuspensionTravel: 0.9, // Curso máximo da suspensão
         customSlidingRotationalSpeed: -30, // Velocidade de rotação personalizada
         useCustomSlidingRotationalSpeed: true, // Usar velocidade personalizada
      };

      // Criar o veículo raycast
      this.vehicle = new CANNON.RaycastVehicle({
         chassisBody: this.chassisBody,
      });

      // Adiciona as rodas
      // 0 - frontal esquerda
      options.chassisConnectionPointLocal.set(-1.36, 0, 0.7);
      this.vehicle.addWheel(options);

      // 1 - frontal direita
      options.chassisConnectionPointLocal.set(-1.36, 0, -0.7);
      this.vehicle.addWheel(options);

      // 2- traseira esquerda
      options.chassisConnectionPointLocal.set(1.22, 0, 0.7);
      this.vehicle.addWheel(options);

      // 3- traseira direita
      options.chassisConnectionPointLocal.set(1.22, 0, -0.7);
      this.vehicle.addWheel(options);

      // Adicionar o veículo ao mundo físico
      this.vehicle.addToWorld(this.physicsManager.world);

      // Criar as mesh para as rodas
      this.wheelMeshes = [];
      const wheelGeometry = new THREE.CylinderGeometry(
         options.radius,
         options.radius,
         0.28,
         32
      );
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

      // Girar para orientação correta
      wheelGeometry.rotateX(Math.PI / 2);

      // Criar as quatro rodas
      for (let i = 0; i < 4; i++) {
         const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
         wheelMesh.castShadow = true;
         this.scene.add(wheelMesh);
         this.wheelMeshes.push(wheelMesh);
      }

      const wheelSizeAdjustment = 1.1;
      for (let i = 0; i < this.wheelMeshes.length; i++) {
         this.wheelMeshes[i].scale.set(
            wheelSizeAdjustment,
            wheelSizeAdjustment,
            wheelSizeAdjustment
         );
      }

      // Guardar referência à mesh original
      this.originalMesh = this.mesh;

      // Adicionar o chassi ao gerenciador de física
      this.physicsManager.addBody(this.chassisBody, this.mesh);
   }

   async loadCarModel() {
      try {
         // Carregar o modelo
         const carModel = await this.modelLoader.loadModel(
            "/assets/models/car/car.gltf",
            { x: 0.9, y: 0.9, z: 0.9 }
         );

         // Remover a mesh atual da cena
         this.scene.remove(this.mesh);

         // Substituir pela mesh do modelo carregado
         this.mesh = carModel;

         this.mesh.castShadow = true;
         this.mesh.receiveShadow = true;

         this.mesh.position.copy(this.chassisBody.position);

         this.fixAlignment({ x: 0, y: -0.6, z: 0 }, { x: 0, y: -Math.PI / 2, z: 0 });

         this.scene.add(this.mesh);

         // Configurar sombras e materiais
         this.mesh.traverse((child) => {
            if (child.isMesh) {
               child.castShadow = true;
               child.receiveShadow = true;
               child.material.roughness = 0; // Ajustar a rugosidade do material
               child.material.clearcoatRoughness = 0; // Ajustar a rugosidade do revestimento
               child.material.clearcoat = 1; // Ajustar o revestimento
            }
         });

         // Atualizar posição das rodas para se alinharem ao novo modelo
         for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
            this.vehicle.updateWheelTransform(i);
            const transform = this.vehicle.wheelInfos[i].worldTransform;

            this.wheelMeshes[i].position.copy(transform.position);
            this.wheelMeshes[i].quaternion.copy(transform.quaternion);
         }
      } catch (error) {
         console.error("Erro ao carregar o modelo do carro:", error);
      }
   }

   async loadWheelModel () {

   }

   update(deltaTime) {
      const timeStep = Math.min(deltaTime, 1 / 30);

      // ===== CONTROLE DE DIREÇÃO =====
      let targetSteering = 0;
      if (this.inputManager.isKeyPressed("arrowleft")) {
         targetSteering = this.maxSteerVal;
      } else if (this.inputManager.isKeyPressed("arrowright")) {
         targetSteering = -this.maxSteerVal;
      }

      // Ajustar gradualmente em direção ao alvo
      const speedFactor = Math.min(Math.abs(this.currentSpeed) / 100, 1);
      const effectiveSteerSpeed = this.steerSpeed * (1 - speedFactor * 0.5);
      const effectiveReturnSpeed = this.steerReturn * (1 + speedFactor * 0.5);

      if (targetSteering !== 0) {
         // Movimento em direção ao valor alvo
         if (this.currentSteering < targetSteering) {
            this.currentSteering += effectiveSteerSpeed * timeStep;
            if (this.currentSteering > targetSteering)
               this.currentSteering = targetSteering;
         } else if (this.currentSteering > targetSteering) {
            this.currentSteering -= effectiveSteerSpeed * timeStep;
            if (this.currentSteering < targetSteering)
               this.currentSteering = targetSteering;
         }
      } else {
         // Retorno automático para zero
         if (Math.abs(this.currentSteering) < effectiveReturnSpeed * timeStep) {
            this.currentSteering = 0;
         } else if (this.currentSteering > 0) {
            this.currentSteering -= effectiveReturnSpeed * timeStep;
         } else if (this.currentSteering < 0) {
            this.currentSteering += effectiveReturnSpeed * timeStep;
         }
      }

      // Aplicar às rodas 0 e 1 (frente esquerda e direita)
      this.vehicle.setSteeringValue(this.currentSteering, 0);
      this.vehicle.setSteeringValue(this.currentSteering, 1);

      // ==== CONTROLE DE ACELERAÇÃO/FRENAGEM ====
      const velocity = this.vehicle.chassisBody.velocity;
      const chassisForward = new CANNON.Vec3();
      this.chassisBody.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), chassisForward);
      this.currentSpeed = velocity.dot(chassisForward); // Atualiza a velocidade atual com a velocidade forward
      const isAlmostStopped = this.currentSpeed < 2.0;

      let engineForce = 0;
      let brakeForce = 0;
      let handbrakeForce = 0;

      // Determinar aceleração e frenagem com inputs independentes
      const accelerating = this.inputManager.isKeyPressed("arrowup");
      const braking = this.inputManager.isKeyPressed("arrowdown");
      const handbraking =
         this.inputManager.isKeyPressed("b") || this.inputManager.isKeyPressed(" ");
      const boosting = this.inputManager.isKeyPressed("shift");

      this.boostForce *= 0.8; // Reduz a força do boost ao longo do tempo

      if (boosting && this.boostForce < 1) {
         this.boostForce = 4;
      } else {
         this.boostForce = 1;
      }

      // Aplicação de aceleração
      if (accelerating) {
         engineForce = -this.maxForce;
      }

      // Aplicação de frenagem normal
      if (braking) {
         if (isAlmostStopped && !accelerating) {
            // Aceleração reversa apenas se não estiver acelerando para frente também
            engineForce = this.maxForce;
         } else {
            brakeForce = this.brakeForce;
         }
      }

      // Aplicação de freio de mão independente
      if (handbraking) {
         handbrakeForce = this.eBrakeForce;
      }

      engineForce *= this.boostForce;

      // Aplicar força do motor nas rodas
      if (this.tractionDisplacement == "rear") {
         this.vehicle.applyEngineForce(engineForce, 2); // Traseira esquerda
         this.vehicle.applyEngineForce(engineForce, 3); // Traseira direita
      } else if (this.tractionDisplacement == "front") {
         this.vehicle.applyEngineForce(engineForce, 0); // Frontal esquerda
         this.vehicle.applyEngineForce(engineForce, 1); // Frontal direita
      } else {
         this.vehicle.applyEngineForce(engineForce, 0); // Frontal esquerda
         this.vehicle.applyEngineForce(engineForce, 1); // Frontal direita
         this.vehicle.applyEngineForce(engineForce, 2); // Traseira esquerda
         this.vehicle.applyEngineForce(engineForce, 3); // Traseira direita
      }

      // Aplicar freios nas rodas dianteiras
      this.vehicle.setBrake(brakeForce, 0); // Frontal esquerda
      this.vehicle.setBrake(brakeForce, 1); // Frontal direita

      // Aplica freio de mão ou freio nas rodas traseiras
      this.vehicle.setBrake(handbrakeForce != 0 ? handbrakeForce : brakeForce, 2); // Traseira esquerda
      this.vehicle.setBrake(handbrakeForce != 0 ? handbrakeForce : brakeForce, 3); // Traseira direita

      // Atualizar a posição e rotação do modelo 3D do carro
      if (this.mesh && this.originalMesh !== this.mesh) {
         this.fixAlignment({ x: 0, y: -0.6, z: 0 }, { x: 0, y: -Math.PI / 2, z: 0 });
      }

      // Atualizar a posição e rotação das rodas
      for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
         this.vehicle.updateWheelTransform(i);
         const transform = this.vehicle.wheelInfos[i].worldTransform;

         this.wheelMeshes[i].position.copy(transform.position);
         this.wheelMeshes[i].quaternion.copy(transform.quaternion);
      }
   }

   fixAlignment(
      offset = { x: 0, y: 0, z: 0 },
      rotation = { x: 0, y: -Math.PI / 2, z: 0 }
   ) {
      // Copy the physics body position to the mesh
      this.mesh.position.copy(this.chassisBody.position);

      // Apply the position offset in local space
      const localOffset = new THREE.Vector3(offset.x, offset.y, offset.z);
      localOffset.applyQuaternion(this.chassisBody.quaternion);
      this.mesh.position.add(localOffset);

      // Apply the rotation
      this.mesh.quaternion.copy(this.chassisBody.quaternion);
      this.mesh.rotateX(rotation.x);
      this.mesh.rotateY(rotation.y);
      this.mesh.rotateZ(rotation.z);
   }

   getCurrentSpeed() {
      return this.currentSpeed;
   }

   getWheelAngle() {
      return this.vehicle.wheelInfos[0].steering * (180 / Math.PI);
   }
}

export default Player;
