import * as THREE from "three";
import { CSM, CSMParameters } from "three/addons/csm/CSM.js";
import { CSMHelper } from "three/addons/csm/CSMHelper.js";
import GameComponent from "../components/GameComponent";
import { disposeObjects } from "../render/disposeObjects";
import { devMode } from "./DevModeManager";

interface CSMConfig extends CSMParameters {
	lightColor: THREE.Color;
	lightIntensity: number;
	shadowRadius: number;
	/** Deslocamento ao longo da normal, em texels da cascata (cresce com a largura de cada uma). */
	shadowNormalBiasTexels: number;
	/** Fim de cada cascata em metros a partir da câmera; o último valor é o `maxFar`. */
	cascadeSplits: number[];
}
/**
 * Gerenciador de iluminação com CSM
 */
export default class LightingManager extends GameComponent {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private csm: CSM | null = null;
	private csmHelper: CSMHelper | null = null;

	/**
	 * Escala SI (ADR-0002). Direção e cor seguem o brilho do amanhecer no `dawn_4k.hdr`
	 * (azimute ~45°); a elevação de 35° é artística.
	 */
	private readonly config: CSMConfig = {
		cascades: 4,
		cascadeSplits: [10, 26, 64, 200],
		maxFar: 200,
		mode: "custom",
		shadowMapSize: 2048,
		lightDirection: new THREE.Vector3(1, 1, 1).normalize(),
		lightColor: new THREE.Color(0xf6ad8f),
		lightIntensity: 5,
		shadowBias: -0.00005,
		shadowNormalBiasTexels: 1.5,
		shadowRadius: 2,
		lightMargin: 50,
		lightNear: 1,
		lightFar: 600,
	};

	constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.setupCSM();
		this.scene.addEventListener("childadded", this.onChildAdded);
		this.scene.addEventListener("childremoved", this.onChildRemoved);

		devMode.subscribe("lighting-manager", (enabled) => this.enableHelper(enabled));
	}

	/**
	 * Configura o CSM do Three.js
	 */
	private setupCSM(): void {
		const {
			cascades,
			maxFar,
			shadowMapSize,
			lightDirection,
			lightColor,
			lightIntensity,
			shadowBias,
			shadowRadius,
			mode,
			lightNear,
			lightFar,
			lightMargin,
			cascadeSplits,
		} = this.config;

		this.csm = new CSM({
			maxFar,
			cascades: cascades,
			mode,
			customSplitsCallback: (_cascades, _near, far, breaks) => {
				for (const split of cascadeSplits) breaks.push(Math.min(split / far, 1));
			},
			parent: this.scene,
			shadowMapSize,
			lightDirection: lightDirection?.clone().negate(),
			lightIntensity,
			lightNear,
			lightFar,
			lightMargin,
			camera: this.camera,
		});
		this.csm.fade = true;

		this.csm.lights.forEach((light) => {
			light.color.copy(lightColor);
			light.shadow.bias = shadowBias ?? 0;
			light.shadow.radius = shadowRadius;
		});
		this.updateFrustums();
	}

	/**
	 * Configura todos os materiais da cena para usar CSM
	 * Deve ser chamado após criar objetos ou ao carregar novos modelos
	 */
	setupCSMMaterials(): void {
		this.forEachMaterial(this.scene, (material) => this.setupMaterial(material));
	}

	/** Objetos adicionados à cena depois da inicialização (ex.: veículos carregados) também recebem o CSM. */
	private onChildAdded = (event: { child: THREE.Object3D }): void => {
		this.forEachMaterial(event.child, (material) => this.setupMaterial(material));
	};

	private onChildRemoved = (event: { child: THREE.Object3D }): void => {
		this.forEachMaterial(event.child, (material) => this.csm?.shaders.delete(material));
	};

	private forEachMaterial(root: THREE.Object3D, callback: (material: THREE.Material) => void): void {
		root.traverse((object) => {
			if (object instanceof THREE.Mesh) {
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) {
					if (material) callback(material);
				}
			}
		});
	}

	/**
	 * Atualiza o CSM
	 */
	update(_deltaTime: number): void {
		if (this.csm) {
			this.csm.update();
		}

		if (this.csmHelper && devMode.isEnabled()) {
			this.csmHelper.update();
		}
	}

	/**
	 * Configura um material para usar CSM
	 * Deve ser chamado para cada material que deve receber sombras CSM
	 */
	setupMaterial(material: THREE.Material): void {
		if (!this.csm || this.csm.shaders.has(material)) return;
		this.csm.setupMaterial(material);
		material.needsUpdate = true;
	}

	/**
	 * Habilita helper visual
	 */
	private enableHelper(enabled: boolean): void {
		if (this.csmHelper) {
			disposeObjects([this.csmHelper]);
			this.csmHelper = null;
		}

		if (enabled && this.csm) {
			this.csmHelper = new CSMHelper(this.csm);
			this.csmHelper.visible = true;
			this.scene.add(this.csmHelper);
		}
	}

	/**
	 * Atualiza os frustums das cascatas (chamar se mudar parâmetros da câmera)
	 */
	updateFrustums(): void {
		if (!this.csm) return;
		this.csm.updateFrustums();

		const { shadowMapSize = 2048, shadowNormalBiasTexels } = this.config;
		for (const light of this.csm.lights) {
			const texel = (light.shadow.camera.right - light.shadow.camera.left) / shadowMapSize;
			light.shadow.normalBias = texel * shadowNormalBiasTexels;
		}
	}

	/**
	 * Remove luzes e helper da cena, libera shadow maps e desfaz o CSM dos materiais
	 */
	dispose(): void {
		devMode.unsubscribe("lighting-manager");
		this.scene.removeEventListener("childadded", this.onChildAdded);
		this.scene.removeEventListener("childremoved", this.onChildRemoved);
		this.enableHelper(false);

		if (this.csm) {
			this.csm.remove();
			for (const light of this.csm.lights) light.dispose();
			this.csm.dispose();
			this.csm = null;
		}
	}
}
