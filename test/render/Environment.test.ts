import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import Environment from "../../src/components/Environment";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";
import { collectGpuResources, GpuResource } from "../../src/render/disposeObjects";

const hdr = { delayMs: 0, textures: [] as THREE.Texture[] };

vi.mock("three/addons/loaders/HDRLoader.js", () => ({
	HDRLoader: class {
		load(_url: string, onLoad: (texture: THREE.Texture) => void): void {
			const texture = new THREE.DataTexture();
			hdr.textures.push(texture);
			setTimeout(() => onLoad(texture), hdr.delayMs);
		}
	},
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function trackDisposal(resources: Iterable<GpuResource>): Set<GpuResource> {
	const disposed = new Set<GpuResource>();
	for (const resource of resources) resource.addEventListener("dispose", () => disposed.add(resource));
	return disposed;
}

describe("Environment", () => {
	it("dispose remove plano, caixas e corpos e libera geometrias, materiais e a textura do céu", async () => {
		hdr.delayMs = 0;
		const scene = new THREE.Scene();
		const physics = await RapierPhysicsWorld.create(scene);
		const before = physics.countObjects();
		const environment = new Environment(scene, physics);
		await wait(5);

		const resources = collectGpuResources(scene.children);
		const texture = hdr.textures.at(-1)!;
		const disposed = trackDisposal([...resources, texture]);
		expect(scene.environment).toBe(texture);
		expect(scene.children).toHaveLength(4);

		environment.dispose();

		expect(scene.children).toHaveLength(0);
		expect(physics.countObjects()).toEqual(before);
		expect(disposed).toEqual(new Set([...resources, texture]));
		expect(scene.background).toBeNull();
		expect(scene.environment).toBeNull();
		physics.dispose();
	});

	it("textura do céu que chega depois do dispose é liberada e não entra na cena", async () => {
		hdr.delayMs = 10;
		const scene = new THREE.Scene();
		const physics = await RapierPhysicsWorld.create(scene);
		const environment = new Environment(scene, physics);
		const texture = hdr.textures.at(-1)!;
		const disposed = trackDisposal([texture]);

		environment.dispose();
		await wait(20);

		expect(disposed.has(texture)).toBe(true);
		expect(scene.background).toBeNull();
		expect(scene.environment).toBeNull();
		physics.dispose();
	});
});
