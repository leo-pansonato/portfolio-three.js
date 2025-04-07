import GameComponent from "./GameComponent";

/**
 * Classe base para entidades de jogo
 */
class Entity extends GameComponent {
   constructor(scene) {
      super();
      this.scene = scene;
      this.mesh = null;
   }

   addToScene() {
      if (this.mesh && this.scene) {
         this.scene.add(this.mesh);
      }
   }

   removeFromScene() {
      if (this.mesh && this.scene) {
         this.scene.remove(this.mesh);
      }
   }

   getPosition() {
      return this.mesh ? this.mesh.position : null;
   }

   getRotation() {
      return this.mesh ? this.mesh.rotation : null;
   }
}

export default Entity;