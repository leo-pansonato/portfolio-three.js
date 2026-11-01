/**
 * Implementação otimizada de Simplex Noise 2D/3D
 * Baseado no algoritmo de Ken Perlin (2001)
 */
export default class SimplexNoise {
	private perm: Uint8Array;
	private permMod12: Uint8Array;

	// Gradientes para 2D
	private static readonly grad3 = [
		[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
		[1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
		[0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
	];

	// Constantes para Simplex 2D
	private static readonly F2 = 0.5 * (Math.sqrt(3) - 1);
	private static readonly G2 = (3 - Math.sqrt(3)) / 6;

	constructor(seed: number = Math.random() * 65536) {
		this.perm = new Uint8Array(512);
		this.permMod12 = new Uint8Array(512);
		this.setSeed(seed);
	}

	/**
	 * Define a seed para geração determinística
	 */
	setSeed(seed: number): void {
		// Função de hash simples baseada na seed
		const random = this.createSeededRandom(seed);

		// Criar tabela de permutação
		const p = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			p[i] = i;
		}

		// Embaralhar usando Fisher-Yates
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[p[i], p[j]] = [p[j], p[i]];
		}

		// Duplicar para evitar overflow
		for (let i = 0; i < 512; i++) {
			this.perm[i] = p[i & 255];
			this.permMod12[i] = this.perm[i] % 12;
		}
	}

	/**
	 * Cria um gerador de números aleatórios com seed
	 */
	private createSeededRandom(seed: number): () => number {
		let s = seed;
		return () => {
			s = (s * 1103515245 + 12345) & 0x7fffffff;
			return s / 0x7fffffff;
		};
	}

	/**
	 * Simplex Noise 2D
	 * Retorna valor entre -1 e 1
	 */
	noise2D(x: number, y: number): number {
		const F2 = SimplexNoise.F2;
		const G2 = SimplexNoise.G2;
		const grad3 = SimplexNoise.grad3;

		// Skew para encontrar célula do simplex
		const s = (x + y) * F2;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);

		const t = (i + j) * G2;
		const X0 = i - t;
		const Y0 = j - t;
		const x0 = x - X0;
		const y0 = y - Y0;

		// Determinar qual simplex estamos
		let i1: number, j1: number;
		if (x0 > y0) {
			i1 = 1; j1 = 0;
		} else {
			i1 = 0; j1 = 1;
		}

		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;

		// Índices da tabela de permutação
		const ii = i & 255;
		const jj = j & 255;

		// Calcular contribuição de cada canto
		let n0 = 0, n1 = 0, n2 = 0;

		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0) {
			const gi0 = this.permMod12[ii + this.perm[jj]];
			t0 *= t0;
			n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0);
		}

		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0) {
			const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
			t1 *= t1;
			n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1);
		}

		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0) {
			const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
			t2 *= t2;
			n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2);
		}

		// Escalar para [-1, 1]
		return 70 * (n0 + n1 + n2);
	}

	/**
	 * Fractal Brownian Motion (fBm) - múltiplas oitavas de noise
	 * Cria terrenos mais naturais com detalhes em várias escalas
	 */
	fbm2D(
		x: number,
		y: number,
		octaves: number = 6,
		lacunarity: number = 2.0,
		persistence: number = 0.5
	): number {
		let total = 0;
		let frequency = 1;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			total += this.noise2D(x * frequency, y * frequency) * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}

		return total / maxValue;
	}

	/**
	 * Ridged Multifractal - cria cristas e vales acentuados
	 * Bom para montanhas
	 */
	ridgedMultifractal2D(
		x: number,
		y: number,
		octaves: number = 6,
		lacunarity: number = 2.0,
		gain: number = 0.5,
		offset: number = 1.0
	): number {
		let sum = 0;
		let frequency = 1;
		let amplitude = 0.5;
		let prev = 1;

		for (let i = 0; i < octaves; i++) {
			const n = offset - Math.abs(this.noise2D(x * frequency, y * frequency));
			const signal = n * n * prev;
			sum += signal * amplitude;
			prev = signal;
			frequency *= lacunarity;
			amplitude *= gain;
		}

		return sum;
	}
}
