import { createRoot } from "react-dom/client";

import "./hud.css";

import Hud from "./components/Hud";
import HudStore from "./HudStore";
import { hudCssVariables } from "./tokens";

/** HUD montado: o jogo escreve `store.frame` e chama `store.publish(dt)` uma vez por quadro */
export interface MountedHud {
	readonly store: HudStore;
	dispose(): void;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Monta o HUD de corrida em `container` (camada DOM sobre o canvas) */
export function mountHud(container: HTMLElement): MountedHud {
	for (const [name, value] of Object.entries(hudCssVariables())) container.style.setProperty(name, value);

	const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
	const store = new HudStore(media?.matches ?? false);
	const onMotionChange = (event: MediaQueryListEvent) => store.setReducedMotion(event.matches);
	media?.addEventListener("change", onMotionChange);

	const root = createRoot(container);
	root.render(<Hud store={store} />);

	return {
		store,
		dispose() {
			media?.removeEventListener("change", onMotionChange);
			root.unmount();
		},
	};
}
