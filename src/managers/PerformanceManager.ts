import Stats from "three/addons/libs/stats.module.js";
import GameComponent from "../components/GameComponent";

/**
 * Gerenciador de desempenho
 */
export default class PerformanceManager extends GameComponent {
   public stats: Stats;

   constructor() {
      super();
      this.stats = new Stats();
      this.initialize();
   }

   initialize(): void {
      const container = document.getElementById("fps-container");
      if (container) {
         this.stats.showPanel(0);
         container.appendChild(this.stats.dom);
         this.stats.dom.style.position = "relative";
      }
   }

   // Agora ele apenas atualiza o painel do Stats.js
   update(): any {
      this.stats.update();
   }
}
