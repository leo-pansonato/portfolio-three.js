import GameComponent from "../components/GameComponent.js";

/**
 * Gerenciador de interface do usuário
 */
class UIManager extends GameComponent {
   constructor() {
      super();
      this.devMode = true;
      this.devOverlay = document.getElementById("dev-overlay");
      this.speedCounter = document.getElementById("speed");
      this.positionCounter = document.getElementById("position");
      this.rotationCounter = document.getElementById("rotation");
      this.wheelAngleCounter = document.getElementById("wheel-angle");
      this.physicsManager = null;
      
      this.ui = {
         overlays: {
            dev: this.devOverlay,
         },
         controls: {
            keys: document.getElementById("ctrlKeys"),
            mouse: document.getElementById("ctrlMouse"),
            scroll: document.getElementById("ctrlScroll"),
         },
      };
   }

   setupDevMode(physicsManager) {
      if (!physicsManager) return;
      
      this.physicsManager = physicsManager;
      this.changeDevMode(this.devMode);
   }

   changeDevMode(mode) {
      if (!this.physicsManager) return;
      
      // if (mode) {
      //    this.physicsManager.addDebugger();
      // } else {
      //    this.physicsManager.removeDebugger();
      // }
      
      if (this.devOverlay) {
         this.devOverlay.style.display = mode ? "flex" : "none";
      }
      
      this.devMode = mode;
   }

   toggleDevMode() {
      this.changeDevMode(!this.devMode);
   }

   updatePlayerInfo(deltaTime, player) {
      if (!this.devMode || !this.physicsManager) return;
      
      const speed = player.getCurrentSpeed();
      const position = player.getPosition();
      const rotation = player.getRotation();
      const wheelAngle = player.getWheelAngle();
      
      // Atualizar o debugger física
      this.physicsManager.updateDebugger();

      // Atualiza os contadores de velocidade, posição e rotação
      this.speedCounter.textContent = speed.toFixed(2);
      this.positionCounter.textContent = `X: ${position.x.toFixed(
         2
      )} Y: ${position.y.toFixed(2)} Z: ${position.z.toFixed(2)}`;
      this.rotationCounter.textContent = `X: ${rotation.x.toFixed(
         2
      )} Y: ${rotation.y.toFixed(2)} Z: ${rotation.z.toFixed(2)}`;
      this.wheelAngleCounter.textContent = wheelAngle.toFixed(2) + "°";  
   }
}

export default UIManager;