import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PhysicsBody, PhysicsWorld } from "../../src/physics/PhysicsWorld";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";

/** Contrato dos eventos de força de contato do PhysicsWorld (P2-11, etapa 2) */

const GRAVITY = 9.82;
const MASS = 100;
const HALF = 0.5;
const DROP_HEIGHT = 1.25;

async function dropBox(threshold?: number): Promise<{ world: PhysicsWorld; ground: PhysicsBody; box: PhysicsBody }> {
	const world = await RapierPhysicsWorld.create(new THREE.Scene());
	const ground = world.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
	world.createGroundCollider(ground, 0.8, 50);
	const box = world.createRigidBody({ type: "dynamic", position: { x: 2, y: HALF + DROP_HEIGHT, z: -3 } });
	world.createCollider(
		{
			shape: "cuboid",
			halfExtents: { x: HALF, y: HALF, z: HALF },
			density: MASS / (8 * HALF * HALF * HALF),
			restitution: 0,
			contactForceThreshold: threshold,
		},
		box,
	);
	return { world, ground, box };
}

/** Soma os impulsos dos eventos de `updates` updates de um passo */
function collect(world: PhysicsWorld, updates: number): { impulse: number; count: number } {
	let impulse = 0;
	let count = 0;
	for (let i = 0; i < updates; i++) {
		world.update(world.fixedTimeStep);
		for (let e = 0; e < world.contactEventCount(); e++) {
			impulse += world.getContactEvent(e).impulse;
			count++;
		}
	}
	return { impulse, count };
}

describe("PhysicsWorld — eventos de força de contato", () => {
	it("queda: impulso ≈ quantidade de movimento no choque, com corpos e ponto do contato", async () => {
		const threshold = 2 * MASS * GRAVITY;
		const { world, ground, box } = await dropBox(threshold);
		const impactSpeed = Math.sqrt(2 * GRAVITY * DROP_HEIGHT);

		let first: { bodies: Set<PhysicsBody | null>; point: { x: number; y: number; z: number } } | null = null;
		let impulse = 0;
		for (let i = 0; i < 90; i++) {
			world.update(world.fixedTimeStep);
			for (let e = 0; e < world.contactEventCount(); e++) {
				const event = world.getContactEvent(e);
				impulse += event.impulse;
				first ??= { bodies: new Set([event.bodyA, event.bodyB]), point: { ...event.point } };
			}
		}

		expect(first).not.toBeNull();
		expect(first!.bodies).toEqual(new Set([ground, box]));
		expect(first!.point.x).toBeCloseTo(2, 1);
		expect(Math.abs(first!.point.y)).toBeLessThan(0.05);
		expect(first!.point.z).toBeCloseTo(-3, 1);
		expect(impulse / (MASS * impactSpeed)).toBeGreaterThan(0.9);
		expect(impulse / (MASS * impactSpeed)).toBeLessThan(1.2);
		world.dispose();
	});

	it("em repouso abaixo do limiar: nenhum evento", async () => {
		const { world } = await dropBox(2 * MASS * GRAVITY);
		collect(world, 120);

		expect(collect(world, 60).count).toBe(0);
		world.dispose();
	});

	it("sem limiar no colisor: nenhum evento", async () => {
		const { world } = await dropBox();

		expect(collect(world, 90).count).toBe(0);
		world.dispose();
	});

	it("eventos valem só para o último update e somam todos os passos dele", async () => {
		const { world } = await dropBox(2 * MASS * GRAVITY);
		let event = null;
		for (let i = 0; i < 90 && !event; i++) {
			world.update(world.fixedTimeStep);
			if (world.contactEventCount() > 0) event = world.getContactEvent(0);
		}
		expect(event).not.toBeNull();

		collect(world, 120);
		world.update(world.fixedTimeStep);
		expect(world.contactEventCount()).toBe(0);
		expect(() => world.getContactEvent(0)).toThrow(RangeError);

		const { world: other } = await dropBox(2 * MASS * GRAVITY);
		other.update(1);
		expect(other.contactEventCount()).toBeGreaterThan(0);
		world.dispose();
		other.dispose();
	});
});
