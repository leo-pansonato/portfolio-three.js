import { InputFrame } from "../input/InputFrame";
import { Replay, REPLAY_BOOST, REPLAY_HANDBRAKE, ReplayInitialState } from "./Replay";

/**
 * Grava um InputFrame por passo de física em buffers pré-alocados; `record` não aloca.
 * Ao encher a capacidade, para de gravar e mantém o que já tem.
 */
export default class ReplayRecorder {
	/** Capacidade padrão: 10 min a 60 Hz (passos) */
	static readonly DEFAULT_CAPACITY = 36000;

	private readonly throttle: Float64Array;
	private readonly brake: Float64Array;
	private readonly steer: Float64Array;
	private readonly buttons: Uint8Array;
	private length = 0;
	private initial: ReplayInitialState | null = null;
	private fixedTimeStep = 0;

	constructor(readonly capacity: number = ReplayRecorder.DEFAULT_CAPACITY) {
		this.throttle = new Float64Array(capacity);
		this.brake = new Float64Array(capacity);
		this.steer = new Float64Array(capacity);
		this.buttons = new Uint8Array(capacity);
	}

	get isRecording(): boolean {
		return this.initial !== null;
	}

	get isFull(): boolean {
		return this.length >= this.capacity;
	}

	get stepCount(): number {
		return this.length;
	}

	/** @param fixedTimeStep passo fixo do mundo (s) */
	start(initial: ReplayInitialState, fixedTimeStep: number): void {
		this.initial = initial;
		this.fixedTimeStep = fixedTimeStep;
		this.length = 0;
	}

	/** Chamar uma vez por passo de física com o InputFrame usado pelo controle nesse passo */
	record(frame: Readonly<InputFrame>): void {
		if (this.initial === null || this.length >= this.capacity) return;
		const i = this.length++;
		this.throttle[i] = frame.throttle;
		this.brake[i] = frame.brake;
		this.steer[i] = frame.steer;
		this.buttons[i] = (frame.handbrake ? REPLAY_HANDBRAKE : 0) | (frame.boost ? REPLAY_BOOST : 0);
	}

	/** Encerra a gravação; null se não estava gravando */
	stop(): Replay | null {
		const initial = this.initial;
		if (initial === null) return null;
		this.initial = null;
		return {
			fixedTimeStep: this.fixedTimeStep,
			initial,
			stepCount: this.length,
			throttle: this.throttle.slice(0, this.length),
			brake: this.brake.slice(0, this.length),
			steer: this.steer.slice(0, this.length),
			buttons: this.buttons.slice(0, this.length),
		};
	}
}
