import { describe, expect, it, vi } from "vitest";
import { createInputFrame } from "../../src/input/InputFrame";
import { Replay } from "../../src/replay/Replay";
import ReplayPlayback from "../../src/replay/ReplayPlayback";
import ReplayRecorder from "../../src/replay/ReplayRecorder";
import { createRapierSim, RapierSimHandle } from "../support/rapierSim";
import { DriveInput, idleInput } from "../support/sim";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		clearCache(): void {}
	},
}));

interface Trajectory {
	/** Chassi no pré-passo, depois do controle: posição (m), rotação, velocidades linear (m/s) e angular (rad/s) */
	poses: number[][];
	stop(): void;
}

function sampleSteps(sim: RapierSimHandle): Trajectory {
	const poses: number[][] = [];
	const position = { x: 0, y: 0, z: 0 };
	const rotation = { x: 0, y: 0, z: 0, w: 1 };
	const linear = { x: 0, y: 0, z: 0 };
	const angular = { x: 0, y: 0, z: 0 };
	const callback = () => {
		const body = sim.player.physics.chassisBody;
		body.getPosition(position);
		body.getRotation(rotation);
		body.getLinearVelocity(linear);
		body.getAngularVelocity(angular);
		poses.push([
			position.x,
			position.y,
			position.z,
			rotation.x,
			rotation.y,
			rotation.z,
			rotation.w,
			linear.x,
			linear.y,
			linear.z,
			angular.x,
			angular.y,
			angular.z,
		]);
	};
	sim.physicsWorld.addPreStepCallback(callback);
	return { poses, stop: () => sim.physicsWorld.removePreStepCallback(callback) };
}

function drive(sim: RapierSimHandle, input: Partial<DriveInput>, seconds: number, frameDt: number): void {
	Object.assign(sim.input, idleInput(), input);
	for (let i = 0; i < Math.round(seconds / frameDt); i++) sim.frame(frameDt);
}

const SCRIPT: Array<[Partial<DriveInput>, number]> = [
	[{ throttle: true }, 2],
	[{ throttle: true, right: true }, 1.5],
	[{ throttle: true, left: true, boost: true }, 0.5],
	[{ brake: true }, 1.5],
	[{ handbrake: true, right: true }, 0.5],
	[{}, 0.5],
];

interface Recording {
	replay: Replay;
	poses: number[][];
	final: number[];
}

function chassisVector(sim: RapierSimHandle): number[] {
	const s = sim.player.physics.captureChassisState({
		position: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		linearVelocity: { x: 0, y: 0, z: 0 },
		angularVelocity: { x: 0, y: 0, z: 0 },
	});
	return [
		s.position.x,
		s.position.y,
		s.position.z,
		s.rotation.x,
		s.rotation.y,
		s.rotation.z,
		s.rotation.w,
		s.linearVelocity.x,
		s.linearVelocity.y,
		s.linearVelocity.z,
		s.angularVelocity.x,
		s.angularVelocity.y,
		s.angularVelocity.z,
	];
}

async function record(vehicleId: string, frameDt: number): Promise<Recording> {
	const sim = await createRapierSim(vehicleId);
	drive(sim, {}, 1.5, frameDt);
	drive(sim, { throttle: true, left: true }, 1, frameDt);

	sim.player.startRecording();
	const trajectory = sampleSteps(sim);
	for (const [input, seconds] of SCRIPT) drive(sim, input, seconds, frameDt);
	const replay = sim.player.stopRecording();
	trajectory.stop();

	expect(replay).not.toBeNull();
	return { replay: replay!, poses: trajectory.poses, final: chassisVector(sim) };
}

async function play(replay: Replay, frameDt: number): Promise<number[][]> {
	const sim = await createRapierSim("bmw_f82");
	drive(sim, { throttle: true }, 0.7, frameDt);

	sim.player.playReplay(replay);
	const trajectory = sampleSteps(sim);
	Object.assign(sim.input, idleInput(), { brake: true, left: true });
	while (trajectory.poses.length <= replay.stepCount) sim.frame(frameDt);
	trajectory.stop();
	expect(sim.player.isReplaying).toBe(false);
	return trajectory.poses;
}

describe("replay", () => {
	it.each([
		["bmw_f82", 1 / 144, 1 / 60],
		["mercedes_g63", 1 / 60, 1 / 30],
	])(
		"%s: gravado a %f s/quadro e reproduzido a %f s/quadro em um mundo novo repete a trajetória exatamente",
		async (vehicleId, recordDt, playDt) => {
			const recording = await record(vehicleId, recordDt);
			const steps = recording.replay.stepCount;
			expect(steps).toBe(Math.round(6.5 / recording.replay.fixedTimeStep));
			expect(recording.replay.initial.vehicleId).toBe(vehicleId);
			expect(
				Math.hypot(recording.replay.initial.linearVelocity.x, recording.replay.initial.linearVelocity.z),
			).toBeGreaterThan(3);

			const played = await play(recording.replay, playDt);

			expect(played.slice(0, steps)).toEqual(recording.poses);
			expect(played[steps].slice(0, 7)).toEqual(recording.final.slice(0, 7));

			const start = recording.poses[0];
			const end = recording.final;
			expect(Math.hypot(end[0] - start[0], end[2] - start[2])).toBeGreaterThan(30);
		},
	);

	it("reset durante a gravação a descarta", async () => {
		const sim = await createRapierSim("bmw_f82");
		sim.player.startRecording();
		drive(sim, { throttle: true }, 0.5, 1 / 60);
		sim.player.resetCar();
		expect(sim.player.isRecording).toBe(false);
		expect(sim.player.stopRecording()).toBeNull();
	});

	it("rejeita replay com passo fixo diferente do mundo", async () => {
		const recording = await record("bmw_f82", 1 / 60);
		const sim = await createRapierSim("bmw_f82", 1 / 120);
		expect(() => sim.player.playReplay(recording.replay)).toThrow();
	});
});

describe("ReplayRecorder / ReplayPlayback", () => {
	const initial = {
		vehicleId: "bmw_f82",
		position: { x: 0, y: 1, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		linearVelocity: { x: 0, y: 0, z: 0 },
		angularVelocity: { x: 0, y: 0, z: 0 },
		steeringAngle: 0,
	};

	it("devolve os InputFrame gravados, na ordem e com os mesmos valores", () => {
		const recorder = new ReplayRecorder(8);
		recorder.start(initial, 1 / 60);
		const frame = createInputFrame();
		const frames = [
			{ throttle: 0.3141592653589793, brake: 0, steer: -0.123456789, handbrake: false, boost: true },
			{ throttle: 0, brake: 1, steer: 1, handbrake: true, boost: false },
			{ throttle: 1, brake: 0.5, steer: 0, handbrake: true, boost: true },
		];
		for (const f of frames) recorder.record(Object.assign(frame, f));
		const replay = recorder.stop()!;

		const playback = new ReplayPlayback(replay);
		const played = [];
		while (playback.advance()) played.push({ ...playback.frame });
		expect(played).toEqual(frames);
		expect(playback.finished).toBe(true);
	});

	it("para de gravar ao encher a capacidade", () => {
		const recorder = new ReplayRecorder(2);
		recorder.start(initial, 1 / 60);
		for (let i = 0; i < 5; i++) recorder.record(createInputFrame());
		expect(recorder.isFull).toBe(true);
		expect(recorder.stop()!.stepCount).toBe(2);
	});
});
