import { useEffect, useRef } from "react";

import { formatSpeed, leadingZeros, stableInteger } from "../format";
import HudStore from "../HudStore";
import { damp } from "../smoothing";
import { HUD_ANIMATION } from "../tokens";

const DIGITS = 3;

/** Velocidade em km/h: suavizada, com histerese e algarismos tabulares; escrita direto no DOM */
export default function Speedometer({ store }: { store: HudStore }) {
	const leadRef = useRef<HTMLSpanElement>(null);
	const valueRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const lead = leadRef.current;
		const value = valueRef.current;
		if (!lead || !value) return undefined;

		let smoothed = 0;
		let shown = 0;
		return store.onFrame((frame, dt) => {
			smoothed = damp(smoothed, frame.speedKmh, HUD_ANIMATION.speedLambda, dt);
			const next = stableInteger(smoothed, shown, HUD_ANIMATION.speedHysteresisKmh);
			if (next === shown) return;
			shown = next;
			const text = formatSpeed(next);
			value.textContent = text;
			lead.textContent = leadingZeros(text, DIGITS);
		});
	}, [store]);

	return (
		<div className="hud-speed">
			<span className="hud-speed__number">
				<span className="hud-speed__lead" ref={leadRef}>
					00
				</span>
				<span className="hud-speed__value" ref={valueRef}>
					0
				</span>
			</span>
			<span className="hud-speed__unit">km/h</span>
		</div>
	);
}
