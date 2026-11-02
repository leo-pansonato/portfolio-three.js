import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import Player from "../../src/components/Player";
import InputManager from "../../src/managers/InputManager";
import PhysicsManager from "../../src/managers/PhysicsManager";
import { ScriptedInput } from "../support/sim";

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(): Promise<null> {
			return null;
		}
		clearCache(): void {}
	},
}));

const STEP = 1 / 60;
const FRAME_DT = 1 / 144;

function runFrames(seconds: number, frame: () => void): void {
	const frames = Math.round(seconds / FRAME_DT);
	for (let i = 0; i < frames; i++) frame();
}

/**
 * Interpolação visual (ROADMAP P1-1): a 144 Hz com física a 60 Hz, o mesh avança
 * por quadro de forma uniforme em vez de alternar entre parado e um passo inteiro.
 */
describe("interpolação visual entre passos", () => {
	it("corpo em velocidade constante: deslocamento por quadro uniforme, 1 passo atrás", async () => {
		const physics = await PhysicsManager.create(new THREE.Scene(), STEP);
		const body = physics.createRigidBody({ type: "kinematicVelocityBased", position: { x: 0, y: 0, z: 0 } });
		const speed = 10; // m/s
		body.setLinvel({ x: speed, y: 0, z: 0 }, true);
		const mesh = new THREE.Object3D();
		physics.addEntity(body, mesh);

		let time = STEP;
		physics.update(STEP);
		let previousX = mesh.position.x;
		for (let i = 0; i < 144; i++) {
			physics.update(FRAME_DT);
			time += FRAME_DT;
			// visual = pose no instante (tempo acumulado − 1 passo)
			expect(mesh.position.x).toBeCloseTo(speed * (time - STEP), 4);
			expect(mesh.position.x - previousX).toBeCloseTo(speed * FRAME_DT, 4);
			previousX = mesh.position.x;
		}
	});

	it("veículo a 144 FPS: chassi e rodas avançam sem quadros parados", async () => {
		const scene = new THREE.Scene();
		const physics = await PhysicsManager.create(scene, STEP);
		const groundBody = physics.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
		physics.createGroundCollider(groundBody, 0.8, 1000);
		const input = new ScriptedInput();
		const player = new Player(scene, input as unknown as InputManager, physics);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const frame = () => {
			physics.update(FRAME_DT);
			player.update(FRAME_DT);
		};
		runFrames(2, frame);
		input.state.throttle = true;
		runFrames(3, frame);
		input.state.throttle = false;

		const chassis = player.getPosition();
		const wheel = (player as any).view.wheelMeshes[0] as THREE.Object3D;
		const chassisSteps: number[] = [];
		const wheelSteps: number[] = [];
		const lastChassis = chassis.clone();
		const lastWheel = wheel.position.clone();
		runFrames(0.5, () => {
			frame();
			chassisSteps.push(chassis.distanceTo(lastChassis));
			wheelSteps.push(wheel.position.distanceTo(lastWheel));
			lastChassis.copy(chassis);
			lastWheel.copy(wheel.position);
		});

		// rolando a ~70 km/h o deslocamento por quadro quase não varia;
		// sem interpolação, a 144 Hz parte dos quadros fica parada (mínimo 0)
		for (const series of [chassisSteps, wheelSteps]) {
			const min = Math.min(...series);
			const max = Math.max(...series);
			expect(min).toBeGreaterThan(0);
			expect(max / min).toBeLessThan(1.05);
		}
	});
});
