import { log } from "three/tsl";
import GameComponent from "../components/GameComponent";

/**
 * Gerenciador de entrada do usuário
 */
class InputManager extends GameComponent {
   constructor(game) {
      super();
      this.game = game;
      this.keys = {};
      this.mouse = {
         x: 0,
         y: 0,
         isDown: false,
      };
      this.setupEventListeners();
   }

   setupEventListeners() {
      document.addEventListener("keydown", (e) => this.handleKeyDown(e));
      document.addEventListener("keyup", (e) => this.handleKeyUp(e));
      document.addEventListener("mousedown", (e) => this.handleMouseDown(e));
      document.addEventListener("mouseup", (e) => this.handleMouseUp(e));
   }

   handleKeyDown(e) {
      const key = e.key.toLowerCase();
      this.keys[key] = true;

      // Funções especiais para teclas específicas
      if (key === "f2") {
         this.game.ui.toggleDevMode();
      }
      if (key === "c") {
         this.game.player.changeVehicle("mercedes_g63");
      } 
      if (key === "v") {
         this.game.player.changeVehicle("bmw_f82");
      } 

   }

   handleKeyUp(e) {
      this.keys[e.key.toLowerCase()] = false;
   }

   handleMouseDown(e) {
      this.mouse.isDown = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
   }

   handleMouseUp(e) {
      this.mouse.isDown = false;
   }

   isKeyPressed(key) {
      return this.keys[key] === true;
   }

   isMouseDown() {
      return this.mouse.isDown;
   }

   getMousePosition() {
      return { x: this.mouse.x, y: this.mouse.y };
   }
}

export default InputManager;