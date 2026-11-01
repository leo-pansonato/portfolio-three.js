import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import Player from "../../src/components/Player";
import InputManager from "../../src/managers/InputManager";
import PhysicsManager from "../../src/managers/PhysicsManager";
import { ScriptedInput } from "../support/sim";

const loadDelayMs: Record<string, number> = {};

vi.mock("../../src/loaders/ModelLoader", () => ({
	default: class {
		async loadModel(path: string): Promise<null> {
			const delay = Object.entries(loadDelayMs).find(([key]) => path.includes(key))?.[1] ?? 0;
			await new Promise((resolve) => setTimeout(resolve, delay));
			return null;
		}
		clearCache(): void {}
	},
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createPlayer() {
	const scene = new THREE.Scene();
	const physics = await PhysicsManager.create(scene);
	const player = new Player(scene, new ScriptedInput() as unknown as InputManager, physics);
	return { scene, physics, player };
}

describe("ciclo de vida do veículo", () => {
	it("trocar de veículo não acumula objetos no mundo físico, na cena nem na GPU", async () => {
		const { scene, physics, player } = await createPlayer();
		await wait(5);

		const counts = () => ({
			bodies: physics.world.bodies.len(),
			colliders: physics.world.colliders.len(),
			controllers: physics.world.vehicleControllers.size,
			sceneObjects: scene.children.length,
		});
		const initial = counts();
		const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");

		for (let i = 0; i < 20; i++) {
			await player.changeVehicle(i % 2 === 0 ? "mercedes_g63" : "bmw_f82");
			physics.update(1 / 60);
		}

		expect(counts()).toEqual(initial);
		expect(initial.controllers).toBe(1);
		// cada troca descarta o placeholder e o modelo anterior (chassi + rodas)
		expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(20 * 2);
		disposeSpy.mockRestore();
	});

	it("um carregamento antigo que termina depois não substitui o veículo atual", async () => {
		loadDelayMs["bmw_m4_f82"] = 30;
		const { scene, player } = await createPlayer();

		await player.changeVehicle("mercedes_g63");
		await wait(60);
		delete loadDelayMs["bmw_m4_f82"];

		const vehicleMeshes = scene.children.filter((child) => child === player.mesh);
		expect(vehicleMeshes).toHaveLength(1);
		expect((player as any).currentVehicleId).toBe("mercedes_g63");
		const wheelRadii = scene.children
			.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry)
			.map((wheel) => (wheel.geometry as THREE.CylinderGeometry).parameters.radiusTop);
		// raio da roda do G63 em m (o BMW usa 0.33)
		expect(wheelRadii).toEqual([0.38, 0.38, 0.38, 0.38]);
		// chassi + 4 rodas do veículo atual
		expect(scene.children.length).toBe(5);
	});
});
