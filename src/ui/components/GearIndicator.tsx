import { formatGear } from "../format";

interface GearIndicatorProps {
	gear: number;
	previousGear: number;
}

/** Marcha num círculo; cada troca remonta o valor e dispara a animação de entrada (CSS) */
export default function GearIndicator({ gear, previousGear }: GearIndicatorProps) {
	const direction = gear > previousGear ? "up" : gear < previousGear ? "down" : "none";
	return (
		<div className="hud-gear" data-direction={direction} data-gear={formatGear(gear)}>
			<span key={`p${gear}`} className="hud-gear__pulse" />
			<span key={gear} className="hud-gear__value">
				{formatGear(gear)}
			</span>
		</div>
	);
}
