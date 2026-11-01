import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import PhysicsManager from "../managers/PhysicsManager";
import SimplexNoise from "../utils/SimplexNoise";

/**
 * Configuração do terreno procedural
 */
export interface TerrainConfig {
	/** Largura do terreno em unidades */
	width: number;
	/** Profundidade do terreno em unidades */
	depth: number;
	/** Número de segmentos na largura (resolução) */
	widthSegments: number;
	/** Número de segmentos na profundidade (resolução) */
	depthSegments: number;
	/** Altura máxima das elevações */
	maxHeight: number;
	/** Altura mínima (pode ser negativo para vales) */
	minHeight: number;
	/** Seed para geração determinística (mesma seed = mesmo terreno) */
	seed: number;
	/** Escala do noise (menor = colinas maiores, maior = mais detalhado) */
	noiseScale: number;
	/** Número de oitavas de noise (mais = mais detalhes) */
	octaves: number;
	/** Lacunaridade - quão rápido a frequência aumenta por oitava */
	lacunarity: number;
	/** Persistência - quão rápido a amplitude diminui por oitava */
	persistence: number;
	/** Usar ridged multifractal para montanhas mais acentuadas */
	useRidged: boolean;
	/** Aplicar falloff nas bordas (terreno desce nas bordas) */
	edgeFalloff: boolean;
	/** Distância do falloff da borda (0-1) */
	falloffDistance: number;
}

/**
 * Configuração de cores do terreno baseadas em altura
 */
export interface TerrainColorConfig {
	/** Cor para áreas baixas (vales) */
	lowColor: THREE.Color;
	/** Cor para áreas médias */
	midColor: THREE.Color;
	/** Cor para áreas altas (picos) */
	highColor: THREE.Color;
	/** Altura onde começa a transição low->mid (0-1) */
	lowThreshold: number;
	/** Altura onde começa a transição mid->high (0-1) */
	highThreshold: number;
}

/**
 * Gerador de terreno procedural com física Rapier
 */
export default class ProceduralTerrain {
	private scene: THREE.Scene;
	private physicsManager: PhysicsManager;
	private noise: SimplexNoise;

	private config: TerrainConfig;
	private colorConfig: TerrainColorConfig;

	// Referências aos objetos criados
	private terrainMesh: THREE.Mesh | null = null;
	private terrainBody: RAPIER.RigidBody | null = null;
	private heightData: Float32Array | null = null;

	// Configuração padrão
	private static readonly DEFAULT_CONFIG: TerrainConfig = {
		width: 200,
		depth: 200,
		widthSegments: 128,
		depthSegments: 128,
		maxHeight: 15,
		minHeight: -2,
		seed: 42,
		noiseScale: 0.02,
		octaves: 6,
		lacunarity: 2.0,
		persistence: 0.5,
		useRidged: false,
		edgeFalloff: true,
		falloffDistance: 0.15,
	};

	private static readonly DEFAULT_COLOR_CONFIG: TerrainColorConfig = {
		lowColor: new THREE.Color(0x2d5a27),    // Verde escuro (grama)
		midColor: new THREE.Color(0x8b7355),    // Marrom (terra/rocha)
		highColor: new THREE.Color(0x9a9a9a),  // Cinza (rocha)
		lowThreshold: 0.3,
		highThreshold: 0.7,
	};

	constructor(
		scene: THREE.Scene,
		physicsManager: PhysicsManager,
		config: Partial<TerrainConfig> = {},
		colorConfig: Partial<TerrainColorConfig> = {}
	) {
		this.scene = scene;
		this.physicsManager = physicsManager;

		// Mesclar configurações
		this.config = { ...ProceduralTerrain.DEFAULT_CONFIG, ...config };
		this.colorConfig = { ...ProceduralTerrain.DEFAULT_COLOR_CONFIG, ...colorConfig };

		// Inicializar noise com seed
		this.noise = new SimplexNoise(this.config.seed);
	}

	/**
	 * Gera o terreno completo (visual + física)
	 */
	generate(): void {
		console.log("Gerando terreno procedural...");
		const startTime = performance.now();

		// Gerar heightmap
		this.generateHeightData();

		// Criar mesh visual
		this.createTerrainMesh();

		// Criar collider físico
		this.createPhysicsCollider();

		const elapsed = performance.now() - startTime;
		console.log(`Terreno gerado em ${elapsed.toFixed(2)}ms`);
	}

	/**
	 * Gera os dados de altura do terreno
	 */
	private generateHeightData(): void {
		const { widthSegments, depthSegments, noiseScale, octaves, lacunarity, persistence, useRidged } = this.config;

		// +1 porque segments são divisões, não vértices
		const cols = widthSegments + 1;
		const rows = depthSegments + 1;
		this.heightData = new Float32Array(cols * rows);

		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				// Coordenadas normalizadas (0 a 1)
				const nx = i / widthSegments;
				const nz = j / depthSegments;

				// Coordenadas para noise
				const x = nx * this.config.width * noiseScale;
				const z = nz * this.config.depth * noiseScale;

				// Gerar valor de noise
				let noiseValue: number;
				if (useRidged) {
					noiseValue = this.noise.ridgedMultifractal2D(x, z, octaves, lacunarity, persistence);
					noiseValue = noiseValue * 0.5; // Normalizar um pouco
				} else {
					noiseValue = this.noise.fbm2D(x, z, octaves, lacunarity, persistence);
				}

				// Normalizar para 0-1
				noiseValue = (noiseValue + 1) * 0.5;

				// Aplicar falloff nas bordas se configurado
				if (this.config.edgeFalloff) {
					const falloff = this.calculateEdgeFalloff(nx, nz);
					noiseValue *= falloff;
				}

				// Mapear para altura final
				const height = THREE.MathUtils.lerp(
					this.config.minHeight,
					this.config.maxHeight,
					noiseValue
				);

				this.heightData[j * cols + i] = height;
			}
		}
	}

	/**
	 * Calcula o falloff das bordas para suavizar as transições
	 */
	private calculateEdgeFalloff(nx: number, nz: number): number {
		const falloff = this.config.falloffDistance;

		// Distância das bordas (0 na borda, 1 no centro)
		const distX = Math.min(nx, 1 - nx) / falloff;
		const distZ = Math.min(nz, 1 - nz) / falloff;
		const dist = Math.min(distX, distZ);

		// Aplicar curva suave (smoothstep)
		const t = THREE.MathUtils.clamp(dist, 0, 1);
		return t * t * (3 - 2 * t);
	}

	/**
	 * Cria a mesh visual do terreno
	 */
	private createTerrainMesh(): void {
		if (!this.heightData) return;

		const { width, depth, widthSegments, depthSegments } = this.config;

		// Criar geometria do plano
		const geometry = new THREE.PlaneGeometry(width, depth, widthSegments, depthSegments);

		// Rotacionar para ficar horizontal (plano começa vertical)
		geometry.rotateX(-Math.PI / 2);

		// Aplicar alturas aos vértices
		const positions = geometry.attributes.position;
		const colors = new Float32Array(positions.count * 3);

		const heightRange = this.config.maxHeight - this.config.minHeight;

		for (let i = 0; i < positions.count; i++) {
			// Aplicar altura (Y no Three.js após rotação)
			const height = this.heightData[i];
			positions.setY(i, height);

			// Calcular cor baseada na altura normalizada
			const normalizedHeight = (height - this.config.minHeight) / heightRange;
			const color = this.getColorForHeight(normalizedHeight);
			colors[i * 3] = color.r;
			colors[i * 3 + 1] = color.g;
			colors[i * 3 + 2] = color.b;
		}

		// Adicionar atributo de cor
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

		// Recalcular normais para iluminação correta
		geometry.computeVertexNormals();

		// Material com vertex colors
		const material = new THREE.MeshStandardMaterial({
			vertexColors: true,
			roughness: 0.85,
			metalness: 0.1,
			flatShading: false,
		});

		// Criar mesh
		this.terrainMesh = new THREE.Mesh(geometry, material);
		this.terrainMesh.receiveShadow = true;
		this.terrainMesh.castShadow = false;

		this.scene.add(this.terrainMesh);
	}

	/**
	 * Interpola cor baseada na altura normalizada
	 */
	private getColorForHeight(normalizedHeight: number): THREE.Color {
		const { lowColor, midColor, highColor, lowThreshold, highThreshold } = this.colorConfig;
		const result = new THREE.Color();

		if (normalizedHeight < lowThreshold) {
			// Área baixa
			result.copy(lowColor);
		} else if (normalizedHeight < highThreshold) {
			// Transição low -> mid -> high
			const midPoint = (lowThreshold + highThreshold) / 2;
			if (normalizedHeight < midPoint) {
				const t = (normalizedHeight - lowThreshold) / (midPoint - lowThreshold);
				result.lerpColors(lowColor, midColor, this.smoothstep(t));
			} else {
				const t = (normalizedHeight - midPoint) / (highThreshold - midPoint);
				result.lerpColors(midColor, highColor, this.smoothstep(t));
			}
		} else {
			// Área alta
			result.copy(highColor);
		}

		// Adicionar variação sutil baseada na altura
		const variation = (Math.random() - 0.5) * 0.05;
		result.r = THREE.MathUtils.clamp(result.r + variation, 0, 1);
		result.g = THREE.MathUtils.clamp(result.g + variation, 0, 1);
		result.b = THREE.MathUtils.clamp(result.b + variation, 0, 1);

		return result;
	}

	/**
	 * Função smoothstep para transições suaves
	 */
	private smoothstep(t: number): number {
		return t * t * (3 - 2 * t);
	}

	/**
	 * Cria o collider físico do terreno usando TriMesh do Rapier
	 * TriMesh é mais confiável que Heightfield para terrenos
	 */
	private createPhysicsCollider(): void {
		if (!this.heightData || !this.terrainMesh) return;

		// Criar RigidBody estático para o terreno
		this.terrainBody = this.physicsManager.createRigidBody({
			type: "static",
			position: { x: 0, y: 0, z: 0 },
		});

		// Extrair vértices e índices da geometria do Three.js
		const geometry = this.terrainMesh.geometry;
		const positionAttribute = geometry.getAttribute('position');
		const indexAttribute = geometry.getIndex();

		if (!positionAttribute || !indexAttribute) {
			console.error('Geometria do terreno não tem position ou index');
			return;
		}

		// Criar array de vértices (x, y, z para cada vértice)
		const vertices = new Float32Array(positionAttribute.count * 3);
		for (let i = 0; i < positionAttribute.count; i++) {
			vertices[i * 3] = positionAttribute.getX(i);
			vertices[i * 3 + 1] = positionAttribute.getY(i);
			vertices[i * 3 + 2] = positionAttribute.getZ(i);
		}

		// Criar array de índices (cada triângulo tem 3 índices)
		const indices = new Uint32Array(indexAttribute.count);
		for (let i = 0; i < indexAttribute.count; i++) {
			indices[i] = indexAttribute.getX(i);
		}

		// Criar descritor do TriMesh
		const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);

		// Configurar propriedades físicas
		trimeshDesc.setFriction(0.8);
		trimeshDesc.setRestitution(0.1);

		// Criar o collider
		this.physicsManager.world.createCollider(trimeshDesc, this.terrainBody);
		
		console.log(`TriMesh criado: ${positionAttribute.count} vértices, ${indexAttribute.count / 3} triângulos`);
	}

	/**
	 * Obtém a altura do terreno em uma posição mundial
	 */
	getHeightAt(worldX: number, worldZ: number): number {
		if (!this.heightData) return 0;

		const { width, depth, widthSegments, depthSegments } = this.config;

		// Converter coordenadas mundiais para coordenadas do grid
		const gridX = ((worldX + width / 2) / width) * widthSegments;
		const gridZ = ((worldZ + depth / 2) / depth) * depthSegments;

		// Clamp para dentro dos limites
		const cols = widthSegments + 1;

		const x0 = Math.floor(THREE.MathUtils.clamp(gridX, 0, widthSegments - 1));
		const z0 = Math.floor(THREE.MathUtils.clamp(gridZ, 0, depthSegments - 1));
		const x1 = Math.min(x0 + 1, widthSegments);
		const z1 = Math.min(z0 + 1, depthSegments);

		// Frações para interpolação
		const fx = gridX - x0;
		const fz = gridZ - z0;

		// Obter alturas dos 4 cantos
		const h00 = this.heightData[z0 * cols + x0];
		const h10 = this.heightData[z0 * cols + x1];
		const h01 = this.heightData[z1 * cols + x0];
		const h11 = this.heightData[z1 * cols + x1];

		// Interpolação bilinear
		const h0 = THREE.MathUtils.lerp(h00, h10, fx);
		const h1 = THREE.MathUtils.lerp(h01, h11, fx);
		return THREE.MathUtils.lerp(h0, h1, fz);
	}

	/**
	 * Obtém a normal do terreno em uma posição mundial
	 */
	getNormalAt(worldX: number, worldZ: number): THREE.Vector3 {
		const epsilon = 0.5;
		const hL = this.getHeightAt(worldX - epsilon, worldZ);
		const hR = this.getHeightAt(worldX + epsilon, worldZ);
		const hD = this.getHeightAt(worldX, worldZ - epsilon);
		const hU = this.getHeightAt(worldX, worldZ + epsilon);

		const normal = new THREE.Vector3(hL - hR, 2 * epsilon, hD - hU);
		return normal.normalize();
	}

	/**
	 * Regenera o terreno com nova seed
	 */
	regenerate(newSeed?: number): void {
		if (newSeed !== undefined) {
			this.config.seed = newSeed;
			this.noise.setSeed(newSeed);
		}

		this.dispose();
		this.generate();
	}

	/**
	 * Atualiza configuração e regenera
	 */
	updateConfig(newConfig: Partial<TerrainConfig>): void {
		this.config = { ...this.config, ...newConfig };
		if (newConfig.seed !== undefined) {
			this.noise.setSeed(this.config.seed);
		}
		this.dispose();
		this.generate();
	}

	/**
	 * Remove o terreno da cena e da física
	 */
	dispose(): void {
		// Remover mesh
		if (this.terrainMesh) {
			this.scene.remove(this.terrainMesh);
			this.terrainMesh.geometry.dispose();
			if (this.terrainMesh.material instanceof THREE.Material) {
				this.terrainMesh.material.dispose();
			}
			this.terrainMesh = null;
		}

		// Remover física
		if (this.terrainBody) {
			this.physicsManager.world.removeRigidBody(this.terrainBody);
			this.terrainBody = null;
		}

		this.heightData = null;
	}

	/**
	 * Getters
	 */
	getMesh(): THREE.Mesh | null {
		return this.terrainMesh;
	}

	getConfig(): TerrainConfig {
		return { ...this.config };
	}

	getHeightData(): Float32Array | null {
		return this.heightData;
	}
}
