import * as THREE from "three";
import Player from "../../src/components/Player";
import { PhysicsWorld } from "../../src/physics/PhysicsWorld";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";
import { ScriptedInput, SimHandle, VehicleSnapshot } from "./sim";

/**
 * Monta o veículo real (Player + PhysicsWorld da Rapier) sobre um plano,
 * sem DOM, renderizador nem obstáculos.
 *
 * O chão replica a parte física de Environment.createPlane, porém maior.
 * ModelLoader deve ser mockado pelo teste (o Player cai no fallback de primitivas).
 */
export interface RapierSimHandle extends SimHandle {
	readonly player: Player;
	readonly physicsWorld: PhysicsWorld;
}

/**
 * @param groundHalfSize meia-largura do chão (m); a velocidade máxima precisa de vários km
 */
export async function createRapierSim(
	vehicleId: string,
	fixedTimeStep?: number,
	groundHalfSize = 1000,
): Promise<RapierSimHandle> {
	const scene = new THREE.Scene();
	const physicsWorld: PhysicsWorld = await RapierPhysicsWorld.create(scene, fixedTimeStep);

	const groundBody = physicsWorld.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
	// maior que o plano do jogo (200 m): a frenagem não pode sair do chão
	physicsWorld.createGroundCollider(groundBody, 0.8, groundHalfSize);

	const scripted = new ScriptedInput();
	const player = new Player(scene, scripted, physicsWorld);

	if (vehicleId !== "bmw_f82") {
		await player.changeVehicle(vehicleId);
	}

	// aguarda o carregamento (mockado) iniciado no construtor
	await new Promise((resolve) => setTimeout(resolve, 0));

	return {
		input: scripted.state,
		analog: scripted.analog,
		player,
		physicsWorld,
		frame(deltaTime: number): void {
			// mesma ordem de Game.gameLoop: física, depois componentes
			physicsWorld.update(deltaTime);
			player.update(deltaTime);
		},
		snapshot(): VehicleSnapshot {
			const body = player.physics.chassisBody;
			return {
				position: body.getPosition({ x: 0, y: 0, z: 0 }),
				velocity: body.getLinearVelocity({ x: 0, y: 0, z: 0 }),
				quaternion: body.getRotation({ x: 0, y: 0, z: 0, w: 1 }),
				hudSpeed: player.getCurrentSpeed(),
			};
		},
	};
}
