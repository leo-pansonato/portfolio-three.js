/**
 * Tokens de design do HUD. Fonte única: o CSS lê as variáveis geradas por `hudCssVariables`,
 * e as constantes de animação são lidas pelos componentes.
 */
export const HUD_TOKENS = {
	color: {
		ink: "#ffffff",
		inkSoft: "rgba(255, 255, 255, 0.72)",
		inkFaint: "rgba(255, 255, 255, 0.3)",
		track: "rgba(255, 255, 255, 0.16)",
		redline: "#ff3b4e",
		redlineGlow: "rgba(255, 59, 78, 0.55)",
		accent: "#ff2f8e",
		backdrop: "rgba(8, 10, 16, 0.42)",
		shadow: "rgba(0, 0, 0, 0.5)",
	},
	font: {
		display: '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif',
		weightRegular: "600",
		weightBold: "700",
		weightHeavy: "800",
	},
	/** Tamanhos em unidades do HUD (`--hud-u` ≈ 1 px a 1080p, escala pela menor dimensão da tela) */
	size: {
		gutter: 56,
		tachometer: 300,
		gearDisc: 92,
		gearText: 64,
		speedText: 88,
		unitText: 22,
		labelText: 15,
	},
	motion: {
		easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
		easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
		enterMs: 900,
		gearMs: 320,
		fadeMs: 280,
		shiftBlinkMs: 140,
	},
} as const;

/** Constantes das animações contínuas (por quadro, independentes do FPS) */
export const HUD_ANIMATION = {
	/** Frequência natural da mola crítica do ponteiro (rad/s) */
	needleOmega: 16,
	/** Taxa da suavização exponencial da velocidade exibida (1/s) */
	speedLambda: 10,
	/** Histerese do número da velocidade (km/h) além do meio inteiro */
	speedHysteresisKmh: 0.3,
	/** Menor variação do ponteiro escrita no DOM (graus) */
	needleEpsilonDeg: 0.02,
} as const;

/** Variáveis CSS (`--hud-*`) geradas a partir dos tokens */
export function hudCssVariables(): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const [name, value] of Object.entries(HUD_TOKENS.color)) vars[`--hud-color-${kebab(name)}`] = value;
	vars["--hud-font-display"] = HUD_TOKENS.font.display;
	vars["--hud-weight-regular"] = HUD_TOKENS.font.weightRegular;
	vars["--hud-weight-bold"] = HUD_TOKENS.font.weightBold;
	vars["--hud-weight-heavy"] = HUD_TOKENS.font.weightHeavy;
	for (const [name, value] of Object.entries(HUD_TOKENS.size))
		vars[`--hud-size-${kebab(name)}`] = `calc(var(--hud-u) * ${value})`;
	vars["--hud-ease-out"] = HUD_TOKENS.motion.easeOut;
	vars["--hud-ease-in-out"] = HUD_TOKENS.motion.easeInOut;
	vars["--hud-enter-ms"] = `${HUD_TOKENS.motion.enterMs}ms`;
	vars["--hud-gear-ms"] = `${HUD_TOKENS.motion.gearMs}ms`;
	vars["--hud-fade-ms"] = `${HUD_TOKENS.motion.fadeMs}ms`;
	vars["--hud-shift-blink-ms"] = `${HUD_TOKENS.motion.shiftBlinkMs}ms`;
	return vars;
}

function kebab(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
