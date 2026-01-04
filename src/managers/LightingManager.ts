import * as THREE from "three";
import { CSM, CSMParameters } from "three/addons/csm/CSM.js";
import { CSMHelper } from "three/addons/csm/CSMHelper.js";
import GameComponent from "../components/GameComponent";
import { devMode } from "./DevModeManager";

interface CSMConfig extends CSMParameters {
	lightColor: THREE.Color;
	lightIntensity: number;
	shadowRadius: number;
}
/**
 * Gerenciador de iluminação com CSM
 */
export default class LightingManager extends GameComponent {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private csm: CSM | null = null;
	private csmHelper: CSMHelper | null = null;

	// Configurações do CSM
	private readonly config: CSMConfig = {
		cascades: 3,
		maxFar: 50,
		shadowMapSize: 4096,
		lightDirection: new THREE.Vector3(1, 1, 1).normalize(),
		lightColor: new THREE.Color(0xf6ad8f),
		lightIntensity: 5,
		shadowBias: -0.0007,
		shadowRadius: 2,
		mode: "practical",
		lightMargin: 10,
		lightFar: 100,
	};

	constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.setupCSM();

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
		} = this.config;

		this.csm = new CSM({
			maxFar,
			cascades: cascades,
			mode,
			parent: this.scene,
			shadowMapSize,
			lightDirection: lightDirection?.clone().negate(),
			lightIntensity,
			lightNear,
			lightFar,
			lightMargin,
			camera: this.camera,
		});

		this.csm.lights.forEach((light) => {
			light.color.copy(lightColor);
			light.shadow.bias = shadowBias ?? -0.0005;
			light.shadow.radius = shadowRadius;
		});

		// Log da configuração
		// console.log("CSM initialized:", {
		// 	cascades: cascades,
		// 	maxFar,
		// 	shadowMapSize,
		// 	mode,
		// });
	}

   /**
	 * Configura todos os materiais da cena para usar CSM
	 * Deve ser chamado após criar objetos ou ao carregar novos modelos
	 */
	setupCSMMaterials(): void {
		this.scene.traverse((object) => {
			if (object instanceof THREE.Mesh) {
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				materials.forEach((material) => {
					if (material) {
						this.setupMaterial(material);
					}
				});
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
		if (this.csm) {
			this.csm.setupMaterial(material);
		}
	}


	/**
	 * Habilita helper visual
	 */
	private enableHelper(enabled: boolean): void {
      if (this.csmHelper) {
         this.scene.remove(this.csmHelper);
         this.csmHelper.dispose();
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
		if (this.csm) {
			this.csm.updateFrustums();
		}
	}

	/**
	 * Remove todas as luzes e limpa recursos
	 */
	dispose(): void {
		devMode.unsubscribe("lighting-manager");
      this.enableHelper(false);

		if (this.csm) {
			this.csm.dispose();
			this.csm = null;
		}
	}
}
