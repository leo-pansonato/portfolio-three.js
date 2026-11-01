import * as CANNON from "cannon-es";
import * as THREE from "three";
import Player from "../../src/components/Player";
import InputManager from "../../src/managers/InputManager";
import PhysicsManager from "../../src/managers/PhysicsManager";
import { ScriptedInput, SimHandle, VehicleSnapshot } from "./sim";

/**
 * Monta o veículo real (Player + PhysicsManager da master) sobre um plano,
 * sem DOM, renderizador nem obstáculos.
 *
 * O chão replica a parte física de Environment.createPlane.
 * ModelLoader deve ser mockado pelo teste (o Player cai no fallback de primitivas).
 */
export async function createCannonSim(vehicleId: string): Promise<SimHandle> {
	const scene = new THREE.Scene();
	const physicsManager = new PhysicsManager(scene);

	const groundBody = new CANNON.Body({ mass: 0, material: physicsManager.getGroundMaterial() });
	groundBody.addShape(new CANNON.Plane());
	groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
	physicsManager.world.addBody(groundBody);

	const scripted = new ScriptedInput();
	const player = new Player(scene, scripted as unknown as InputManager, physicsManager);

	if (vehicleId !== "bmw_f82") {
		await player.changeVehicle(vehicleId);
	}

	// aguarda o carregamento (mockado) iniciado no construtor
	await new Promise((resolve) => setTimeout(resolve, 0));

	return {
		input: scripted.state,
		frame(deltaTime: number): void {
			// mesma ordem de Game.gameLoop: física, depois componentes
			physicsManager.update(deltaTime);
			player.update(deltaTime);
		},
		snapshot(): VehicleSnapshot {
			const body = player.chassisBody;
			return {
				position: { x: body.position.x, y: body.position.y, z: body.position.z },
				velocity: { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z },
				quaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w },
				hudSpeed: player.getCurrentSpeed(),
			};
		},
	};
}
