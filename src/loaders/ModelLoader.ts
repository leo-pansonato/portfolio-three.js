import * as THREE from "three";
import { GLTFLoader, GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export default class ModelLoader {
	private loader: GLTFLoader;
	private loadingCache: { [key: string]: THREE.Group };

	constructor() {
		this.loader = new GLTFLoader();
		this.loadingCache = {};
	}

	/**
	 * Carrega um modelo 3D com tratamento de erros e caching
	 */
	async loadModel(path: string, scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 }): Promise<THREE.Group | null> {
		const cacheKey = path;

		// Verificar se o modelo já está em cache
		if (this.loadingCache[cacheKey]) {
			const model = this.loadingCache[cacheKey].clone();
			model.scale.set(scale.x, scale.y, scale.z);
			return model;
		}

		// Carregar o modelo
		return new Promise((resolve, reject) => {
			this.loader.load(
				path,
				(gltf: GLTF) => {
					try {
						const model = gltf.scene;

						// Armazenar no cache
						this.loadingCache[cacheKey] = model.clone();

						// Aplicar escala
						model.scale.set(scale.x, scale.y, scale.z);

						resolve(model);
					} catch (processError) {
						console.error("Erro ao processar modelo:", processError);
						reject(processError);
					}
				},
				(xhr: ProgressEvent) => {
					// Progresso do carregamento
					if (xhr.lengthComputable) {
						console.log(`Modelo ${path}: ${((xhr.loaded / xhr.total) * 100).toFixed(1)}% carregado`);
					}
				},
				(error: unknown) => {
					console.error("Erro ao carregar modelo:", error);
					reject(error);
				}
			);
		});
	}

	/**
	 * Limpa o cache de modelos
	 */
	clearCache(): void {
		this.loadingCache = {};
	}
}
