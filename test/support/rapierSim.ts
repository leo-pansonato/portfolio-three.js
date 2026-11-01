import * as THREE from "three";
import Player from "../../src/components/Player";
import InputManager from "../../src/managers/InputManager";
import PhysicsManager from "../../src/managers/PhysicsManager";
import { ScriptedInput, SimHandle, VehicleSnapshot } from "./sim";

/**
 * Monta o veículo real (Player + PhysicsManager) sobre um plano,
 * sem DOM, renderizador nem obstáculos.
 *
 * O chão replica a parte física de Environment.createPlane, porém maior.
 * ModelLoader deve ser mockado pelo teste (o Player cai no fallback de primitivas).
 */
export async function createRapierSim(vehicleId: string, fixedTimeStep?: number): Promise<SimHandle> {
	const scene = new THREE.Scene();
	const physicsManager = await PhysicsManager.create(scene, fixedTimeStep);

	const groundBody = physicsManager.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
	// maior que o plano do jogo (200 m): a frenagem não pode sair do chão
	physicsManager.createGroundCollider(groundBody, 0.8, 1000);

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
			const body = player.physics.chassisBody;
			const p = body.translation();
			const v = body.linvel();
			const q = body.rotation();
			return {
				position: { x: p.x, y: p.y, z: p.z },
				velocity: { x: v.x, y: v.y, z: v.z },
				quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
				hudSpeed: player.getCurrentSpeed(),
			};
		},
	};
}
