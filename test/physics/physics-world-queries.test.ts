import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRaycastHit, PhysicsWorld } from "../../src/physics/PhysicsWorld";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";

/**
 * Contrato do PhysicsWorld para a suspensão própria (ADR-0003, etapa 2):
 * raio com normal e corpo atingido, impulso e velocidade em ponto.
 */

const DOWN = { x: 0, y: -1, z: 0 };

/** As consultas veem os colisores como no fim do último passo */
function step(world: PhysicsWorld): void {
	world.update(world.fixedTimeStep);
}

async function worldWithGround(): Promise<{
	world: PhysicsWorld;
	ground: ReturnType<PhysicsWorld["createRigidBody"]>;
}> {
	const world = await RapierPhysicsWorld.create(new THREE.Scene());
	const ground = world.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 } });
	world.createGroundCollider(ground, 0.8, 50);
	step(world);
	return { world, ground };
}

describe("PhysicsWorld.castRayWithNormal", () => {
	it("devolve distância, ponto, normal e corpo do chão", async () => {
		const { world, ground } = await worldWithGround();
		const hit = createRaycastHit();

		expect(world.castRayWithNormal({ x: 1, y: 2, z: -3 }, DOWN, 10, hit)).toBe(true);
		expect(hit.distance).toBeCloseTo(2, 5);
		expect(hit.point.x).toBeCloseTo(1, 6);
		expect(hit.point.y).toBeCloseTo(0, 5);
		expect(hit.point.z).toBeCloseTo(-3, 6);
		expect(hit.normal.y).toBeCloseTo(1, 6);
		expect(hit.body).toBe(ground);
		world.dispose();
	});

	it("sem acerto dentro do alcance: false e `out` intacto", async () => {
		const { world } = await worldWithGround();
		const hit = createRaycastHit();
		hit.distance = 123;

		expect(world.castRayWithNormal({ x: 0, y: 2, z: 0 }, DOWN, 1.5, hit)).toBe(false);
		expect(world.castRayWithNormal({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 100, hit)).toBe(false);
		expect(hit.distance).toBe(123);
		world.dispose();
	});

	it("ignora o corpo excluído (o raio que nasce dentro do chassi chega ao chão)", async () => {
		const { world, ground } = await worldWithGround();
		const box = world.createRigidBody({ type: "static", position: { x: 0, y: 1, z: 0 } });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 1, y: 0.5, z: 1 } }, box);
		step(world);
		const hit = createRaycastHit();

		expect(world.castRayWithNormal({ x: 0, y: 1, z: 0 }, DOWN, 10, hit)).toBe(true);
		expect(hit.body).toBe(box);
		expect(hit.distance).toBe(0);

		expect(world.castRayWithNormal({ x: 0, y: 1, z: 0 }, DOWN, 10, hit, box)).toBe(true);
		expect(hit.body).toBe(ground);
		expect(hit.distance).toBeCloseTo(1, 5);
		world.dispose();
	});

	it("normal de superfície inclinada", async () => {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const angle = 0.3; // rad em torno de +Z
		const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
		const ramp = world.createRigidBody({ type: "static", position: { x: 0, y: 0, z: 0 }, rotation: q });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 5, y: 0.1, z: 5 } }, ramp);
		step(world);
		const hit = createRaycastHit();

		expect(world.castRayWithNormal({ x: 0, y: 3, z: 0 }, DOWN, 10, hit)).toBe(true);
		expect(hit.normal.x).toBeCloseTo(-Math.sin(angle), 5);
		expect(hit.normal.y).toBeCloseTo(Math.cos(angle), 5);
		expect(hit.body).toBe(ramp);
		world.dispose();
	});

	it("corpo removido deixa de ser devolvido", async () => {
		const { world } = await worldWithGround();
		const box = world.createRigidBody({ type: "static", position: { x: 0, y: 1, z: 0 } });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 1, y: 0.5, z: 1 } }, box);
		step(world);
		world.removeRigidBody(box);
		step(world);
		const hit = createRaycastHit();

		expect(world.castRayWithNormal({ x: 0, y: 3, z: 0 }, DOWN, 10, hit)).toBe(true);
		expect(hit.body).not.toBe(box);
		expect(hit.distance).toBeCloseTo(3, 5);
		world.dispose();
	});
});

describe("PhysicsBody.applyImpulseAtPoint / getVelocityAtPoint", () => {
	// cubo de 1 m e 1.000 kg: I = m·a²/6 = 166,67 kg·m²
	const MASS = 1000;
	const INERTIA = (MASS * 1 * 1) / 6;

	async function cube(): Promise<{ world: PhysicsWorld; body: ReturnType<PhysicsWorld["createRigidBody"]> }> {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const body = world.createRigidBody({ type: "dynamic", position: { x: 0, y: 100, z: 0 }, canSleep: false });
		world.createCollider({ shape: "cuboid", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, density: MASS }, body);
		return { world, body };
	}

	it("no centro de massa equivale a applyImpulse", async () => {
		const { world, body } = await cube();
		body.applyImpulseAtPoint({ x: 500, y: 0, z: 0 }, { x: 0, y: 100, z: 0 });

		const v = body.getLinearVelocity({ x: 0, y: 0, z: 0 });
		const w = body.getAngularVelocity({ x: 0, y: 0, z: 0 });
		expect(v.x).toBeCloseTo(0.5, 5);
		expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(1e-6);
		world.dispose();
	});

	it("fora do centro: Δv = J/m e Δω = I⁻¹ (r × J), na hora", async () => {
		const { world, body } = await cube();
		// J = 100 N·s em +Y aplicado 0,5 m à frente (+X): r × J = (0; 0; 50)
		body.applyImpulseAtPoint({ x: 0, y: 100, z: 0 }, { x: 0.5, y: 100, z: 0 });

		const v = body.getLinearVelocity({ x: 0, y: 0, z: 0 });
		const w = body.getAngularVelocity({ x: 0, y: 0, z: 0 });
		expect(v.y).toBeCloseTo(0.1, 5);
		expect(w.z).toBeCloseTo(50 / INERTIA, 4);
		expect(Math.abs(w.x) + Math.abs(w.y)).toBeLessThan(1e-6);
		world.dispose();
	});

	it("velocidade em ponto = v + ω × (p − centro)", async () => {
		const { world, body } = await cube();
		body.setLinearVelocity({ x: 1, y: 2, z: 3 });
		body.setAngularVelocity({ x: 0, y: 0, z: 2 });

		const out = body.getVelocityAtPoint({ x: 0.5, y: 100, z: 0 }, { x: 0, y: 0, z: 0 });
		// ω × r = (0; 0; 2) × (0,5; 0; 0) = (0; 1; 0)
		expect(out.x).toBeCloseTo(1, 5);
		expect(out.y).toBeCloseTo(3, 5);
		expect(out.z).toBeCloseTo(3, 5);
		world.dispose();
	});
});

describe("ColliderConfig.centerOfMass", () => {
	const MASS = 1000; // kg, cubo de 1 m
	const INERTIA = (MASS * 1 * 1) / 6; // kg·m²
	const OFFSET = -0.3; // m, centro de massa abaixo do centro geométrico

	async function lowCube(): Promise<{ world: PhysicsWorld; body: ReturnType<PhysicsWorld["createRigidBody"]> }> {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const body = world.createRigidBody({ type: "dynamic", position: { x: 0, y: 100, z: 0 }, canSleep: false });
		world.createCollider(
			{
				shape: "cuboid",
				halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
				density: MASS,
				centerOfMass: { x: 0, y: OFFSET, z: 0 },
			},
			body,
		);
		return { world, body };
	}

	it("impulso no centro de massa deslocado não gira; a massa continua densidade × volume", async () => {
		const { world, body } = await lowCube();
		body.applyImpulseAtPoint({ x: 500, y: 0, z: 0 }, { x: 0, y: 100 + OFFSET, z: 0 });

		expect(body.getLinearVelocity({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(0.5, 5);
		const w = body.getAngularVelocity({ x: 0, y: 0, z: 0 });
		expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(1e-6);
		world.dispose();
	});

	it("impulso no centro geométrico gira com braço até o centro de massa: Δω = I⁻¹ (r × J)", async () => {
		const { world, body } = await lowCube();
		// r = (0; 0,3; 0), J = (100; 0; 0): r × J = (0; 0; −30)
		body.applyImpulseAtPoint({ x: 100, y: 0, z: 0 }, { x: 0, y: 100, z: 0 });

		expect(body.getAngularVelocity({ x: 0, y: 0, z: 0 }).z).toBeCloseTo(-30 / INERTIA, 4);
		world.dispose();
	});

	it("rejeita centro de massa sem densidade ou em forma que não seja caixa", async () => {
		const world = await RapierPhysicsWorld.create(new THREE.Scene());
		const body = world.createRigidBody({ type: "dynamic", position: { x: 0, y: 10, z: 0 } });
		const centerOfMass = { x: 0, y: -0.1, z: 0 };
		expect(() => world.createCollider({ shape: "ball", radius: 1, density: 1, centerOfMass }, body)).toThrow();
		expect(() =>
			world.createCollider({ shape: "cuboid", halfExtents: { x: 1, y: 1, z: 1 }, centerOfMass }, body),
		).toThrow();
		world.dispose();
	});
});
