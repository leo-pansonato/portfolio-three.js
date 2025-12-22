import Stats from "three/addons/libs/stats.module.js";
import GameComponent from "../components/GameComponent";

/**
 * Gerenciador de desempenho e FPS
 */
export default class PerformanceManager extends GameComponent {
	private targetFPS: number;
	private frameDuration: number;
	private lastFrameTime: number;
	private fpsCounter: HTMLElement | null;
	private stats: Stats;
	private deltaTime: number;

	constructor(targetFPS: number = 60) {
		super();
		this.targetFPS = targetFPS;
		this.frameDuration = 1000 / targetFPS;
		this.lastFrameTime = performance.now();
		this.fpsCounter = document.getElementById("fps-container");
		this.stats = new Stats();
		this.deltaTime = 0;

		this.initialize();
	}

	initialize(): void {
		if (this.fpsCounter) {
			this.stats.showPanel(0);
			this.fpsCounter.appendChild(this.stats.dom);
			this.stats.dom.style.position = "relative";
		}
	}

	update(now: number): any {
		const delta = now - this.lastFrameTime;

		if (delta >= this.frameDuration) {
			this.deltaTime = delta / 1000; // converte para segundos
			this.lastFrameTime = now;

			if (this.fpsCounter) {
				this.stats.update();
			}

			return true; // renderizar novo quadro
		}

		return false;
	}

	getDeltaTime(): number {
		return this.deltaTime;
	}
}
