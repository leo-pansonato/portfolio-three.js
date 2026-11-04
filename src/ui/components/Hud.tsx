import { useSyncExternalStore } from "react";

import HudStore from "../HudStore";
import GearIndicator from "./GearIndicator";
import Speedometer from "./Speedometer";
import Tachometer from "./Tachometer";

/** HUD de corrida: o React só renderiza estrutura e mudanças discretas (veículo, marcha, visibilidade) */
export default function Hud({ store }: { store: HudStore }) {
	const state = useSyncExternalStore(store.subscribe, store.getState);
	if (!state.spec) return null;

	return (
		<div className="hud" data-visible={state.visible} data-reduced-motion={state.reducedMotion}>
			<div className="hud-cluster">
				<Tachometer store={store} spec={state.spec} reducedMotion={state.reducedMotion}>
					<GearIndicator gear={state.gear} previousGear={state.previousGear} />
				</Tachometer>
				<Speedometer store={store} />
			</div>
		</div>
	);
}
