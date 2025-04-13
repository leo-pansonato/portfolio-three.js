import GameComponent from "../components/GameComponent";

/**
 * Gerenciador de entrada do usuário
 */
class InputManager extends GameComponent {
   constructor(game) {
      super();
      this.game = game;
      this.keys = {};
      this.setupEventListeners();
   }

   setupEventListeners() {
      document.addEventListener("keydown", (e) => this.handleKeyDown(e));
      document.addEventListener("keyup", (e) => this.handleKeyUp(e));
      // document.addEventListener("mousedown", (e) => this.handleMouseDown(e));
      // document.addEventListener("mouseup", (e) => this.handleMouseUp(e));
   }

   handleKeyDown(e) {
      const key = e.key.toLowerCase();
      this.keys[key] = true;

      // Funções especiais para teclas específicas
      if (key === "f2") {
         this.game.ui.toggleDevMode();
      }
   }

   handleKeyUp(e) {
      this.keys[e.key.toLowerCase()] = false;
   }

   isKeyPressed(key) {
      return this.keys[key] === true;
   }
}

export default InputManager;