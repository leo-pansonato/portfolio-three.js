import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import Player from "../../src/components/Player";
import ModelLoader from "../../src/loaders/ModelLoader";
import RapierPhysicsWorld from "../../src/physics/RapierPhysicsWorld";
import { collectGpuResources, GpuResource } from "../../src/render/disposeObjects";
import { ScriptedInput } from "../support/sim";

const gltfLoads: string[] = [];
const loadDelayMs: Record<string, number> = {};

function createFakeModel(): THREE.Group {
	const texture = new THREE.Texture();
	const normalMap = new THREE.Texture();
	const material = new THREE.MeshStandardMaterial({ map: texture, normalMap });
	const glass = new THREE.MeshStandardMaterial({ map: texture, transparent: true });
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const group = new THREE.Group();
	group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(new THREE.SphereGeometry(0.5), [material, glass]));
	return group;
}

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
	GLTFLoader: class {
		load(path: string, onLoad: (gltf: { scene: THREE.Group }) => void): void {
			gltfLoads.push(path);
			const delay = Object.entries(loadDelayMs).find(([key]) => path.includes(key))?.[1] ?? 0;
			setTimeout(() => onLoad({ scene: createFakeModel() }), delay);
		}
	},
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Emula `renderer.info.memory`: recurso alocado ao ser desenhado, liberado no evento `dispose` */
class FakeGpu {
	readonly alive = new Set<GpuResource>();
	private onDispose = (event: { target: unknown }) => this.alive.delete(event.target as GpuResource);

	render(scene: THREE.Scene): void {
		for (const resource of collectGpuResources(scene.children)) {
			if (this.alive.has(resource)) continue;
			this.alive.add(resource);
			resource.addEventListener("dispose", this.onDispose as never);
		}
	}

	counts() {
		const resources = [...this.alive];
		return {
			geometries: resources.filter((resource) => resource instanceof THREE.BufferGeometry).length,
			materials: resources.filter((resource) => resource instanceof THREE.Material).length,
			textures: resources.filter((resource) => resource instanceof THREE.Texture).length,
		};
	}
}

async function createPlayer() {
	const scene = new THREE.Scene();
	const physics = await RapierPhysicsWorld.create(scene);
	const player = new Player(scene, new ScriptedInput(), physics);
	await wait(5);
	return { scene, physics, player };
}

afterEach(() => {
	gltfLoads.length = 0;
	for (const key of Object.keys(loadDelayMs)) delete loadDelayMs[key];
});

describe("ModelLoader", () => {
	it("instâncias compartilham o modelo; a última devolvida libera geometrias, materiais e texturas", async () => {
		const loader = new ModelLoader();
		const first = (await loader.loadModel("carro.gltf"))!;
		const second = (await loader.loadModel("carro.gltf"))!;
		const resources = collectGpuResources([first]);
		const disposed = new Set<GpuResource>();
		for (const resource of resources) resource.addEventListener("dispose", () => disposed.add(resource));

		expect(gltfLoads).toEqual(["carro.gltf"]);
		expect(collectGpuResources([second])).toEqual(resources);
		expect([...resources].filter((resource) => resource instanceof THREE.Texture)).toHaveLength(2);
		expect([...resources].every((resource) => loader.isCached(resource))).toBe(true);

		loader.releaseModel(first);
		expect(disposed.size).toBe(0);
		loader.releaseModel(second);
		expect(disposed).toEqual(resources);

		const third = (await loader.loadModel("carro.gltf"))!;
		expect(gltfLoads).toHaveLength(1);
		expect(collectGpuResources([third])).toEqual(resources);
	});

	it("carregamentos simultâneos do mesmo caminho fazem um só download", async () => {
		const loader = new ModelLoader();
		const [a, b] = await Promise.all([loader.loadModel("x.gltf"), loader.loadModel("x.gltf")]);
		expect(gltfLoads).toEqual(["x.gltf"]);
		expect(a).not.toBe(b);
	});

	it("clearCache descarta só modelos sem instâncias", async () => {
		const loader = new ModelLoader();
		const used = (await loader.loadModel("a.gltf"))!;
		const unused = (await loader.loadModel("b.gltf"))!;
		loader.releaseModel(unused);
		loader.clearCache();

		await loader.loadModel("a.gltf");
		await loader.loadModel("b.gltf");
		expect(gltfLoads).toEqual(["a.gltf", "b.gltf", "b.gltf"]);
		expect([...collectGpuResources([used])].every((resource) => loader.isCached(resource))).toBe(true);
	});
});

describe("recursos de GPU ao trocar de veículo", () => {
	it("20 trocas mantêm constantes geometrias, materiais e texturas vivos e reutilizam o cache", async () => {
		const { scene, physics, player } = await createPlayer();
		const gpu = new FakeGpu();
		gpu.render(scene);
		const initial = gpu.counts();
		const loadsAfterFirstVehicle = gltfLoads.length;

		for (let i = 0; i < 20; i++) {
			await player.changeVehicle(i % 2 === 0 ? "mercedes_g63" : "bmw_f82");
			physics.update(1 / 60);
			gpu.render(scene);
		}

		expect(initial.textures).toBeGreaterThan(0);
		expect(gpu.counts()).toEqual(initial);
		expect(scene.children.length).toBe(5);
		expect(loadsAfterFirstVehicle).toBe(2);
		expect(new Set(gltfLoads).size).toBe(3);
		expect(gltfLoads).toHaveLength(3);
	});

	it("o chassi anterior é liberado na GPU e a roda comum aos dois veículos não", async () => {
		const { scene, player } = await createPlayer();
		const bodyResources = collectGpuResources([player.mesh]);
		const wheelResources = collectGpuResources(scene.children.filter((child) => child !== player.mesh));
		const disposed = new Set<GpuResource>();
		for (const resource of wheelResources) resource.addEventListener("dispose", () => disposed.add(resource));
		const gpu = new FakeGpu();
		gpu.render(scene);

		await player.changeVehicle("mercedes_g63");
		gpu.render(scene);

		expect([...bodyResources].some((resource) => gpu.alive.has(resource))).toBe(false);
		expect(wheelResources.size).toBeGreaterThan(0);
		expect(disposed.size).toBe(0);
		expect([...wheelResources].every((resource) => gpu.alive.has(resource))).toBe(true);
	});

	it("trocas rápidas com carregamentos obsoletos não deixam objetos nem recursos", async () => {
		loadDelayMs["bmw_m4_f82"] = 20;
		const { scene, player } = await createPlayer();
		await wait(30);
		const gpu = new FakeGpu();
		gpu.render(scene);
		const initial = gpu.counts();

		void player.changeVehicle("mercedes_g63");
		void player.changeVehicle("bmw_f82");
		void player.changeVehicle("mercedes_g63");
		await player.changeVehicle("bmw_f82");
		await wait(30);
		gpu.render(scene);

		expect(scene.children.length).toBe(5);
		expect(gpu.counts()).toEqual(initial);
	});
});
