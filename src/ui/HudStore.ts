import { HudVehicleSpec } from "./gauge";

/** Snapshot por quadro escrito pelo jogo e só lido pela UI (reaproveitado, sem alocação) */
export interface HudFrame {
	/** Velocidade (km/h, não negativa) */
	speedKmh: number;
	/** Rotação do motor (rpm) */
	engineRpm: number;
	/** Marcha: 1…n à frente, 0 ponto morto, −1 ré */
	gear: number;
}

/** Estado discreto: cada mudança gera um objeto novo e um render do React */
export interface HudState {
	readonly visible: boolean;
	readonly reducedMotion: boolean;
	readonly spec: HudVehicleSpec | null;
	readonly gear: number;
	/** Marcha anterior à última troca (direção da animação) */
	readonly previousGear: number;
}

export type HudFrameListener = (frame: Readonly<HudFrame>, dt: number) => void;

/**
 * Ponte entre o loop do jogo e o React: o estado discreto é assinado com `useSyncExternalStore`,
 * os valores contínuos chegam aos componentes por `onFrame`, sem render.
 */
export default class HudStore {
	readonly frame: HudFrame = { speedKmh: 0, engineRpm: 0, gear: 1 };
	private state: HudState;
	private listeners: (() => void)[] = [];
	private frameListeners: HudFrameListener[] = [];

	constructor(reducedMotion = false) {
		this.state = { visible: true, reducedMotion, spec: null, gear: 1, previousGear: 1 };
	}

	readonly getState = (): HudState => this.state;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((other) => other !== listener);
		};
	};

	onFrame(listener: HudFrameListener): () => void {
		this.frameListeners.push(listener);
		return () => {
			this.frameListeners = this.frameListeners.filter((other) => other !== listener);
		};
	}

	setVehicle(spec: HudVehicleSpec): void {
		if (this.state.spec === spec) return;
		this.update({ ...this.state, spec });
	}

	setVisible(visible: boolean): void {
		if (this.state.visible === visible) return;
		this.update({ ...this.state, visible });
	}

	setReducedMotion(reducedMotion: boolean): void {
		if (this.state.reducedMotion === reducedMotion) return;
		this.update({ ...this.state, reducedMotion });
	}

	/** Publica o `frame` do quadro: atualiza o estado discreto se a marcha mudou e chama os ouvintes de quadro */
	publish(dt: number): void {
		if (this.frame.gear !== this.state.gear)
			this.update({ ...this.state, gear: this.frame.gear, previousGear: this.state.gear });
		const listeners = this.frameListeners;
		for (let i = 0; i < listeners.length; i++) listeners[i](this.frame, dt);
	}

	private update(state: HudState): void {
		this.state = state;
		const listeners = this.listeners;
		for (let i = 0; i < listeners.length; i++) listeners[i]();
	}
}
