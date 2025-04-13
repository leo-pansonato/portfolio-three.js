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
      this.wheelAngleDisplay = document.getElementById("wheel-angle");
      
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
      this.setupDevMode();
   }

   setupDevMode() {
      this.changeDevMode(this.devMode);
   }

   changeDevMode(mode) {
      if (this.devOverlay) {
         this.devOverlay.style.display = mode ? "flex" : "none";
      }
      this.devMode = mode;
   }

   toggleDevMode() {
      this.changeDevMode(!this.devMode);
   }

   updatePlayerInfo(position, rotation, speed, wheelAngle) {
      if (this.devMode) {
         this.speedCounter.textContent = `Speed: ${speed.toFixed(2)}`;
         this.positionCounter.textContent = `Position:  X: ${position.x.toFixed(
            2
         )} Y: ${position.y.toFixed(2)} Z: ${position.z.toFixed(2)}`;
         this.rotationCounter.textContent = `Rotation:  X: ${rotation.x.toFixed(
            2
         )} Y: ${rotation.y.toFixed(2)} Z: ${rotation.z.toFixed(2)}`;
         this.wheelAngleDisplay.textContent = `Wheel Angle: ${wheelAngle.toFixed(2)}°`;  
      }
   }
}

export default UIManager;