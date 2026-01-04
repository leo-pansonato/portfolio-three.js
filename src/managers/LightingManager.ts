import * as THREE from "three";
import GameComponent from "../components/GameComponent";

interface CascadeConfig {
	light: THREE.DirectionalLight;
	size: number; // Tamanho da área de sombra
	near: number; // Distância near da cascata
	far: number; // Distância far da cascata
}

/**
 * Gerenciador de iluminação com CSM customizado
 * Usa múltiplas DirectionalLights para criar cascatas de sombra
 */
export default class LightingManager extends GameComponent {
	private scene: THREE.Scene;
	private cascades: CascadeConfig[] = [];
	private playerPosition: THREE.Vector3 = new THREE.Vector3();

	// Configurações do CSM
	private readonly config = {
		// Número de cascatas (ajuste conforme necessário)
		cascadeCount: 2,

		// Distância máxima das sombras
		maxDistance: 50,

		// Resolução do shadow map
		shadowMapSizes: [2048, 1024],

		// Direção da luz (normalizada)
		lightDirection: new THREE.Vector3(1, 1, 1).normalize(),
		// Distância da luz em relação ao player
		lightDistance: 30,
		// Cor da luz
		color: 0xf6ad8f,
		// Intensidade base (dividida entre cascatas)
		intensity: 7,
		// Bias das sombras (pode variar por cascata para evitar artefatos)
		shadowBias: [-0.0005, -0.0001],
	};

	constructor(scene: THREE.Scene) {
		super();
		this.scene = scene;
		this.setupCascades();
      this.enableHelper(true);
	}

	/**
	 * Configura as cascatas de sombra automaticamente
	 */
	private setupCascades(): void {
		const { cascadeCount, maxDistance, shadowMapSizes, color, intensity, shadowBias } =
			this.config;

		let currentNear = 0;

		for (let i = 0; i < cascadeCount; i++) {

			// Calcular distâncias near/far para cada cascata
			const lambda = 0.2; // Balanço entre linear e logarítmico
			const linearFar = (maxDistance * (i + 1)) / cascadeCount;
			const logFar = Math.pow(maxDistance, (i + 1) / cascadeCount);
			const far = lambda * linearFar + (1 - lambda) * logFar;
         const size = far;

			// Criar luz direcional para esta cascata
			const light = new THREE.DirectionalLight(color, intensity / (i ^ 2 || 1));

			// Configurar sombras
			light.castShadow = true;

			// Tamanho do shadow map (diminui com cascatas mais distantes)
			const mapSize = shadowMapSizes[i] || shadowMapSizes[shadowMapSizes.length - 1];
			light.shadow.mapSize.width = mapSize;
			light.shadow.mapSize.height = mapSize;

			// Configurar câmera ortográfica da sombra
			light.shadow.camera.left = -size;
			light.shadow.camera.right = size;
			light.shadow.camera.top = size;
			light.shadow.camera.bottom = -size;
			light.shadow.camera.near = currentNear;
			light.shadow.camera.far = this.config.lightDistance + size;
         

			light.shadow.bias = shadowBias[i] || shadowBias[shadowBias.length - 1];
         
			// Adicionar blur suave
			light.shadow.radius = 2 + i;

			// Adicionar à cena
			this.scene.add(light);
			this.scene.add(light.target);

			// Guardar configuração da cascata
			this.cascades.push({
				light,
				size,
				near: 0.1,
				far,
			});

			currentNear = far;
		}
	}

	/**
	 * Atualiza a posição do player para as luzes seguirem
	 */
	setPlayerPosition(playerPosition: THREE.Vector3): void {
		this.playerPosition.copy(playerPosition);
	}

	/**
	 * Atualiza as posições das luzes para seguir o player
	 */
	update(_deltaTime: number): void {
		const { lightDirection, lightDistance } = this.config;

		this.cascades.forEach((cascade) => {
			// Posicionar luz na direção correta, afastada do player
			cascade.light.position.set(
				this.playerPosition.x + lightDirection.x * lightDistance,
				this.playerPosition.y + lightDirection.y * lightDistance,
				this.playerPosition.z + lightDirection.z * lightDistance
			);

			// Apontar para o player
			cascade.light.target.position.copy(this.playerPosition);
		});
	}

	/**
	 * Retorna todas as luzes das cascatas
	 */
	getLights(): THREE.DirectionalLight[] {
		return this.cascades.map((c) => c.light);
	}

	/**
	 * Retorna a luz principal (primeira cascata)
	 */
	getDirectionalLight(): THREE.DirectionalLight | null {
		return this.cascades[0]?.light || null;
	}

	/**
	 * Ajusta a intensidade de todas as cascatas
	 */
	setIntensity(intensity: number): void {
		const perCascade = intensity / this.cascades.length;
		this.cascades.forEach((cascade) => {
			cascade.light.intensity = perCascade;
		});
	}

	/**
	 * Ajusta a cor de todas as cascatas
	 */
	setColor(color: number | THREE.Color): void {
		this.cascades.forEach((cascade) => {
			cascade.light.color.set(color);
		});
	}

	/**
	 * Ajusta a direção da luz
	 */
	setLightDirection(direction: THREE.Vector3): void {
		this.config.lightDirection.copy(direction).normalize();
	}

	/**
	 * Habilita helpers visuais para debug
	 */
	enableHelper(enabled: boolean): void {
		const helperName = "cascadeHelpers";
		const existingGroup = this.scene.getObjectByName(helperName);

		if (enabled && !existingGroup) {
			const group = new THREE.Group();
			group.name = helperName;

			this.cascades.forEach((cascade, i) => {
				// Helper da luz
				const colors = [0x00ff00, 0xffff00, 0xff0000];
				const helper = new THREE.DirectionalLightHelper(cascade.light, cascade.size * 0.2, colors[i] || 0xffffff);
				group.add(helper);

				// Helper da câmera de sombra
				const cameraHelper = new THREE.CameraHelper(cascade.light.shadow.camera);
				group.add(cameraHelper);
			});

			this.scene.add(group);

			// Log das cascatas
			console.log(
				"CSM Cascades:",
				this.cascades.map((c, i) => ({
					cascade: i + 1,
					size: c.size,
					near: c.near.toFixed(2),
					far: c.far.toFixed(2),
					mapSize: c.light.shadow.mapSize.width,
				}))
			);
		} else if (!enabled && existingGroup) {
			this.scene.remove(existingGroup);
		}
	}

	/**
	 * Remove todas as luzes e limpa recursos
	 */
	dispose(): void {
		this.cascades.forEach((cascade) => {
			this.scene.remove(cascade.light);
			this.scene.remove(cascade.light.target);
			cascade.light.shadow.map?.dispose();
		});
		this.cascades = [];
	}
}
