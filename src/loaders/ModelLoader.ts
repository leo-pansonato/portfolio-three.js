import * as THREE from "three";
import { GLTFLoader, GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { collectGpuResources, GpuResource } from "../render/disposeObjects";

interface CacheEntry {
	template: Promise<THREE.Group>;
	resources: Set<GpuResource>;
	users: number;
}

/**
 * Carrega glTF com cache por caminho. Dono do modelo-base e de suas geometrias, materiais e texturas,
 * compartilhados pelas instâncias; libera a GPU quando a última instância é devolvida e mantém o
 * modelo em memória para reutilizar sem novo download.
 */
export default class ModelLoader {
	private loader: GLTFLoader;
	private entries = new Map<string, CacheEntry>();
	private instances = new WeakMap<THREE.Object3D, CacheEntry>();
	private cachedResources = new Set<GpuResource>();

	constructor(loader: GLTFLoader = new GLTFLoader()) {
		this.loader = loader;
	}

	/**
	 * Instância do modelo (recursos compartilhados com o cache); devolver com `releaseModel`
	 */
	async loadModel(
		path: string,
		scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
	): Promise<THREE.Group | null> {
		const entry = this.entries.get(path) ?? this.createEntry(path);
		entry.users++;

		let template: THREE.Group;
		try {
			template = await entry.template;
		} catch (error) {
			entry.users--;
			if (this.entries.get(path) === entry) this.entries.delete(path);
			throw error;
		}

		const model = template.clone();
		model.scale.set(scale.x, scale.y, scale.z);
		this.instances.set(model, entry);
		return model;
	}

	/** Devolve uma instância criada por `loadModel`; sem outras instâncias, libera os recursos do modelo na GPU */
	releaseModel(model: THREE.Object3D): void {
		const entry = this.instances.get(model);
		if (!entry) return;
		this.instances.delete(model);
		entry.users--;
		if (entry.users === 0) {
			for (const resource of entry.resources) resource.dispose();
		}
	}

	/** Recurso pertencente a um modelo do cache (não deve ser liberado por quem usa a instância) */
	isCached(resource: GpuResource): boolean {
		return this.cachedResources.has(resource);
	}

	/** Descarta do cache os modelos sem instâncias em uso */
	clearCache(): void {
		for (const [path, entry] of this.entries) {
			if (entry.users > 0) continue;
			for (const resource of entry.resources) {
				resource.dispose();
				this.cachedResources.delete(resource);
			}
			this.entries.delete(path);
		}
	}

	private createEntry(path: string): CacheEntry {
		const entry: CacheEntry = { template: this.load(path), resources: new Set(), users: 0 };
		entry.template.then(
			(template) => {
				collectGpuResources([template], entry.resources);
				for (const resource of entry.resources) this.cachedResources.add(resource);
			},
			() => {},
		);
		this.entries.set(path, entry);
		return entry;
	}

	private load(path: string): Promise<THREE.Group> {
		return new Promise((resolve, reject) => {
			this.loader.load(
				path,
				(gltf: GLTF) => resolve(gltf.scene),
				(xhr: ProgressEvent) => {
					if (xhr.lengthComputable) {
						console.log(`Modelo ${path}: ${((xhr.loaded / xhr.total) * 100).toFixed(1)}% carregado`);
					}
				},
				(error: unknown) => {
					console.error("Erro ao carregar modelo:", error);
					reject(error);
				},
			);
		});
	}
}
