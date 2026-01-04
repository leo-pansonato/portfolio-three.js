import * as THREE from "three";
import { CSM, CSMParameters } from "three/addons/csm/CSM.js";
import { CSMHelper } from "three/addons/csm/CSMHelper.js";
import GameComponent from "../components/GameComponent";

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
	private helperEnabled: boolean = false;

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
		this.enableHelper(true);
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
	 * Atualiza o CSM
	 */
	update(_deltaTime: number): void {
		if (this.csm) {
			this.csm.update();
		}

		// Atualizar helper se habilitado
		if (this.csmHelper && this.helperEnabled) {
			this.csmHelper.update();
		}
	}

	/**
	 * Retorna o objeto CSM para configuração de materiais
	 */
	getCSM(): CSM | null {
		return this.csm;
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
	 * Ajusta a intensidade de todas as cascatas
	 */
	setIntensity(intensity: number): void {
		if (this.csm) {
			this.csm.lightIntensity = intensity;
			this.csm.lights.forEach((light) => {
				light.intensity = intensity;
			});
		}
	}

	/**
	 * Ajusta a cor de todas as cascatas
	 */
	setColor(color: number | THREE.Color): void {
		if (this.csm) {
			const threeColor = color instanceof THREE.Color ? color : new THREE.Color(color);
			this.csm.lights.forEach((light) => {
				light.color.copy(threeColor);
			});
		}
	}

	/**
	 * Ajusta a direção da luz
	 */
	setLightDirection(direction: THREE.Vector3): void {
		if (this.csm) {
			// CSM usa direção invertida (de onde a luz vem)
			this.csm.lightDirection.copy(direction).normalize().negate();
		}
	}

	/**
	 * Habilita helpers visuais para debug
	 */
	enableHelper(enabled: boolean): void {
		this.helperEnabled = enabled;

		if (enabled && !this.csmHelper && this.csm) {
			this.csmHelper = new CSMHelper(this.csm);
			this.csmHelper.visible = true;
			this.scene.add(this.csmHelper);

			// Log das cascatas
			console.log("CSM Helper enabled - Cascades:", this.csm.cascades);
		} else if (!enabled && this.csmHelper) {
			this.scene.remove(this.csmHelper);
			this.csmHelper.dispose();
			this.csmHelper = null;
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
		if (this.csmHelper) {
			this.scene.remove(this.csmHelper);
			this.csmHelper.dispose();
			this.csmHelper = null;
		}

		if (this.csm) {
			this.csm.dispose();
			this.csm = null;
		}
	}
}
