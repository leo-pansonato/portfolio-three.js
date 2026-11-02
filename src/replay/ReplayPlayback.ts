import { createInputFrame, InputFrame } from "../input/InputFrame";
import { Replay, REPLAY_BOOST, REPLAY_HANDBRAKE } from "./Replay";

/**
 * Entrega o InputFrame gravado de cada passo; `advance` não aloca.
 */
export default class ReplayPlayback {
	readonly frame: InputFrame = createInputFrame();
	private index = 0;

	constructor(readonly replay: Replay) {}

	get finished(): boolean {
		return this.index >= this.replay.stepCount;
	}

	/** Passos já entregues */
	get stepIndex(): number {
		return this.index;
	}

	/** Escreve em `frame` o próximo passo; false quando acabou */
	advance(): boolean {
		const replay = this.replay;
		if (this.index >= replay.stepCount) return false;
		const i = this.index++;
		const frame = this.frame;
		frame.throttle = replay.throttle[i];
		frame.brake = replay.brake[i];
		frame.steer = replay.steer[i];
		frame.handbrake = (replay.buttons[i] & REPLAY_HANDBRAKE) !== 0;
		frame.boost = (replay.buttons[i] & REPLAY_BOOST) !== 0;
		return true;
	}
}
