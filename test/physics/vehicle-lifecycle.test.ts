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

describe("ciclo de vida do veículo", () => {
	it("trocar de veículo não acumula objetos no mundo físico", async () => {
		const scene = new THREE.Scene();
		const physics = await PhysicsManager.create(scene);
		const player = new Player(scene, new ScriptedInput() as unknown as InputManager, physics);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const counts = () => ({
			bodies: physics.world.bodies.len(),
			colliders: physics.world.colliders.len(),
			controllers: physics.world.vehicleControllers.size,
		});
		const initial = counts();

		for (let i = 0; i < 20; i++) {
			await player.changeVehicle(i % 2 === 0 ? "mercedes_g63" : "bmw_f82");
			physics.update(1 / 60);
		}

		expect(counts()).toEqual(initial);
		expect(initial.controllers).toBe(1);
	});
});
