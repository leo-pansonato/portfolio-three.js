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
         down: false,
         deltaX: 0,
         deltaY: 0,
         lastX: 0,
         lastY: 0
      };
      this.setupEventListeners();
   }

   setupEventListeners() {
      document.addEventListener("keydown", (e) => this.handleKeyDown(e));
      document.addEventListener("keyup", (e) => this.handleKeyUp(e));
      document.addEventListener("mousemove", (e) => this.handleMouseMove(e));
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
   }

   handleKeyUp(e) {
      this.keys[e.key.toLowerCase()] = false;
   }

   handleMouseMove(e) {
      // Calcular o delta apenas se o mouse estiver pressionado
      if (this.mouse.down) {
         this.mouse.deltaX = e.clientX - this.mouse.lastX;
         this.mouse.deltaY = e.clientY - this.mouse.lastY;

         // Atualiza última posição após calcular o delta
         this.mouse.lastX = e.clientX;
         this.mouse.lastY = e.clientY;
      }

      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
   }

   handleMouseDown(e) {
      this.mouse.down = true;
      this.mouse.deltaX = 0;
      this.mouse.deltaY = 0;
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
   }

   handleMouseUp(e) {
      // Quando soltar o mouse, a inércia começará
      this.mouse.down = false;
   }

   isKeyPressed(key) {
      return this.keys[key] === true;
   }

   getMousePosition() {
      return this.mouse;
   }

   getMouseDelta() {
      return { x: this.mouse.deltaX, y: this.mouse.deltaY };
   }

   isMouseDown() {
      return this.mouse.down === true;
   }

   // Limpar os deltas
   resetMouseDelta() {
      this.mouse.deltaX = 0;
      this.mouse.deltaY = 0;
   }
}

export default InputManager;