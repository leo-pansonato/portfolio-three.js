import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';

/**
 * Gerenciador de física usando Cannon.js
 */
class PhysicsManager {
   constructor(scene) {
      this.world = new CANNON.World();
      this.world.gravity.set(0, -9.82, 0); // Gravidade padrão
      this.world.defaultContactMaterial.friction = 0.2;
      this.world.broadphase = new CANNON.SAPBroadphase(this.world);
      this.world.allowSleep = true;

      this.debugger = new CannonDebugger(scene, this.world, {
         color: 0x00ff00,
         scale: 1
      })

      // Materiais para interação entre rodas e solo
      this.groundMaterial = new CANNON.Material('ground');
      this.wheelMaterial = new CANNON.Material('wheel');
      
      // Configurar contato entre materiais
      const wheelGroundContact = new CANNON.ContactMaterial(
         this.wheelMaterial,
         this.groundMaterial,
         {
            friction: 0.5,
            restitution: 0.3,
            contactEquationStiffness: 1000
         }
      );
      this.world.addContactMaterial(wheelGroundContact);
      
      this.bodies = [];
      this.meshes = [];
   }

   update(deltaTime) {
      // Limitando o delta time para evitar problemas
      const timeStep = Math.min(deltaTime, 1/30);
      this.world.step(timeStep);
      
      // Atualizar as posições dos meshes baseado nos corpos físicos
      for (let i = 0; i < this.bodies.length; i++) {
         this.meshes[i].position.copy(this.bodies[i].position);
         this.meshes[i].quaternion.copy(this.bodies[i].quaternion);
      }
   }

   updateDebugger() {
      this.debugger.update();
   }

   addBody(body, mesh) {
      this.world.addBody(body);
      this.bodies.push(body);
      this.meshes.push(mesh);
   }
   
   removeBody(body) {
      const index = this.bodies.indexOf(body);
      if (index !== -1) {
         this.world.removeBody(body);
         this.bodies.splice(index, 1);
         this.meshes.splice(index, 1);
      }
   }
   
   getGroundMaterial() {
      return this.groundMaterial;
   }
   
   getWheelMaterial() {
      return this.wheelMaterial;
   }
}

export default PhysicsManager;