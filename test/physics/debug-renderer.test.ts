import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { devMode } from "../../src/managers/DevModeManager";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";

const STEP = 1 / 60;
const FRAME_DT = 1 / 144;

function debugRoot(scene: THREE.Scene): THREE.Object3D {
	const root = scene.getObjectByName("physics-debug");
	if (!root) throw new Error("debug ausente");
	return root;
}

afterEach(() => devMode.setEnabled(false));

/** Debug físico (ROADMAP P2-9): wireframe na pose interpolada e sem geometria nova por quadro */
describe("PhysicsDebugRenderer", () => {
	it("colisor de corpo dinâmico acompanha a mesh interpolada a 144 Hz", async () => {
		devMode.setEnabled(true);
		const scene = new THREE.Scene();
		const physics = await RapierPhysicsWorld.create(scene, STEP);
		const body = physics.createRigidBody({ type: "kinematicVelocityBased", position: { x: 0, y: 1, z: 0 } });
		physics.createCollider({ shape: "box", halfExtents: { x: 2, y: 0.5, z: 1 } }, body);
		body.setLinearVelocity({ x: 70, y: 0, z: 0 });
		const mesh = new THREE.Object3D();
		physics.addEntity(body, mesh);

		const lines: THREE.LineSegments[] = [];
		const geometries = new Set<THREE.BufferGeometry>();
		for (let i = 0; i < 144; i++) {
			physics.update(FRAME_DT);
			lines.length = 0;
			debugRoot(scene).traverse((o) => {
				if (o instanceof THREE.LineSegments) lines.push(o);
			});
			expect(lines).toHaveLength(1);
			geometries.add(lines[0].geometry);
			const world = new THREE.Vector3();
			lines[0].getWorldPosition(world);
			expect(world.distanceTo(mesh.position)).toBeLessThan(1e-6);
		}
		expect(geometries.size).toBe(1);
		physics.dispose();
	});

	it("reconstrói ao remover corpo e libera a cena ao sair do modo dev", async () => {
		devMode.setEnabled(true);
		const scene = new THREE.Scene();
		const physics = await RapierPhysicsWorld.create(scene, STEP);
		const a = physics.createRigidBody({ type: "dynamic", position: { x: 0, y: 5, z: 0 } });
		physics.createCollider({ shape: "ball", radius: 0.5 }, a);
		const b = physics.createRigidBody({ type: "dynamic", position: { x: 3, y: 5, z: 0 } });
		physics.createCollider({ shape: "cylinder", radius: 0.4, halfHeight: 0.2 }, b);
		physics.update(STEP);
		const count = () => {
			let n = 0;
			debugRoot(scene).traverse((o) => {
				if (o instanceof THREE.LineSegments) n++;
			});
			return n;
		};
		expect(count()).toBe(2);
		physics.removeRigidBody(a);
		physics.update(STEP);
		expect(count()).toBe(1);
		devMode.setEnabled(false);
		expect(scene.getObjectByName("physics-debug")).toBeUndefined();
		physics.dispose();
	});
});
