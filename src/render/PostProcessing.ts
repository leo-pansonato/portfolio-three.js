import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export type PostQuality = "baixa" | "media" | "alta";

/** Pós-processamento ligado/desligado e qualidade, lidos da URL */
export interface PostSettings {
	enabled: boolean;
	quality: PostQuality;
}

interface QualityPreset {
	/** Amostras de MSAA no alvo HDR da cena (0 = sem MSAA) */
	msaaSamples: number;
	bloom: boolean;
	antialias: "fxaa" | "smaa";
}

const PRESETS: Record<PostQuality, QualityPreset> = {
	baixa: { msaaSamples: 0, bloom: false, antialias: "fxaa" },
	media: { msaaSamples: 0, bloom: true, antialias: "smaa" },
	alta: { msaaSamples: 4, bloom: true, antialias: "smaa" },
};

/** Bloom sobre a radiância linear antes do tone mapping (mesma escala da cena, sem exposição) */
const BLOOM = { strength: 0.08, radius: 0.3, threshold: 10 };

/** `?post=0` desliga; `?quality=baixa|media|alta` escolhe o preset (padrão `media`) */
export function readPostSettings(search: string): PostSettings {
	const params = new URLSearchParams(search);
	const quality = params.get("quality");
	return {
		enabled: params.get("post") !== "0",
		quality: quality === "baixa" || quality === "alta" ? quality : "media",
	};
}

/**
 * Cadeia de pós-processamento WebGL2: cena em alvo HDR linear → bloom → OutputPass
 * (tone mapping e espaço de cor do renderer, aplicados só aqui) → SMAA ou FXAA.
 * Acompanha o tamanho do renderer a cada quadro; dono dos alvos e materiais dos passes.
 */
export default class PostProcessing {
	readonly quality: PostQuality;
	private readonly composer: EffectComposer;
	private readonly passes: Pass[] = [];
	private readonly size = new THREE.Vector2();
	private readonly lastSize = new THREE.Vector2();

	constructor(
		private readonly renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.Camera,
		quality: PostQuality = "media",
	) {
		this.quality = quality;
		const preset = PRESETS[quality];
		renderer.getDrawingBufferSize(this.size);

		const target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
			type: THREE.HalfFloatType,
			samples: preset.msaaSamples,
		});
		target.texture.name = "PostProcessing.cena";
		this.composer = new EffectComposer(renderer, target);

		this.addPass(new RenderPass(scene, camera));
		if (preset.bloom) {
			this.addPass(new UnrealBloomPass(this.size, BLOOM.strength, BLOOM.radius, BLOOM.threshold));
		}
		this.addPass(new OutputPass());
		this.addPass(preset.antialias === "smaa" ? new SMAAPass() : new FXAAPass());

		this.syncSize();
	}

	private addPass(pass: Pass): void {
		this.passes.push(pass);
		this.composer.addPass(pass);
	}

	/** Ajusta os alvos se o tamanho do canvas mudou (sem alocação quando não mudou) */
	private syncSize(): void {
		const pixelRatio = this.renderer.getPixelRatio();
		this.renderer.getDrawingBufferSize(this.size);
		if (this.size.equals(this.lastSize)) return;
		this.lastSize.copy(this.size);
		this.composer.setPixelRatio(pixelRatio);
		this.composer.setSize(this.size.x / pixelRatio, this.size.y / pixelRatio);
	}

	/** Renderiza a cena com a cadeia de passes na tela */
	render(): void {
		this.syncSize();
		this.composer.render(0);
	}

	/** Libera alvos, materiais e texturas dos passes e do compositor */
	dispose(): void {
		for (const pass of this.passes) pass.dispose();
		this.passes.length = 0;
		this.composer.dispose();
	}
}
