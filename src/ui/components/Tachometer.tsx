import { ReactNode, useEffect, useMemo, useRef } from "react";

import CriticalSpring from "../CriticalSpring";
import {
	arcPath,
	buildTicks,
	fractionToAngleDeg,
	HudVehicleSpec,
	polarPoint,
	rpmFraction,
	rpmToAngleDeg,
} from "../gauge";
import HudStore from "../HudStore";
import { HUD_ANIMATION } from "../tokens";

const R_TRACK = 92;
const R_FILL = 83;
const R_LABEL = 66;
const NEEDLE_INNER = 36;
const NEEDLE_OUTER = 95;

interface TachometerProps {
	store: HudStore;
	spec: HudVehicleSpec;
	reducedMotion: boolean;
	children?: ReactNode;
}

/** Conta-giros circular: arco graduado, faixa vermelha, preenchimento e ponteiro com mola crítica */
export default function Tachometer({ store, spec, reducedMotion, children }: TachometerProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const needleRef = useRef<SVGGElement>(null);
	const fillRef = useRef<SVGPathElement>(null);

	const geometry = useMemo(() => {
		const end = fractionToAngleDeg(1);
		const start = fractionToAngleDeg(0);
		const redline = rpmToAngleDeg(spec.redlineRpm, spec.dialMaxRpm);
		return {
			track: arcPath(R_TRACK, start, end),
			fill: arcPath(R_FILL, start, end),
			redline: arcPath(R_TRACK, redline, end),
			ticks: buildTicks(spec).map((tick) => ({
				...tick,
				outer: polarPoint(R_TRACK - 2, tick.angleDeg),
				inner: polarPoint(R_TRACK - (tick.major ? 14 : 8), tick.angleDeg),
				labelAt: polarPoint(R_LABEL, tick.angleDeg),
			})),
		};
	}, [spec]);

	useEffect(() => {
		const root = rootRef.current;
		const needle = needleRef.current;
		const fill = fillRef.current;
		if (!root || !needle || !fill) return undefined;

		const spring = new CriticalSpring(HUD_ANIMATION.needleOmega, spec.idleRpm);
		let lastAngle = Number.NaN;
		let shiftAlert = false;

		const write = (rpm: number) => {
			const fraction = rpmFraction(rpm, spec.dialMaxRpm);
			const angle = fractionToAngleDeg(fraction);
			if (Math.abs(angle - lastAngle) < HUD_ANIMATION.needleEpsilonDeg) return;
			lastAngle = angle;
			needle.setAttribute("transform", `rotate(${angle.toFixed(2)})`);
			fill.style.strokeDashoffset = (1 - fraction).toFixed(4);
		};
		write(spring.value);

		return store.onFrame((frame, dt) => {
			const target = Number.isFinite(frame.engineRpm) ? frame.engineRpm : spec.idleRpm;
			if (reducedMotion) spring.reset(target);
			else spring.step(target, dt);
			write(spring.value);

			const alert = frame.gear > 0 && spring.value >= spec.shiftAlertRpm;
			if (alert !== shiftAlert) {
				shiftAlert = alert;
				root.classList.toggle("is-shift", alert);
			}
		});
	}, [store, spec, reducedMotion]);

	return (
		<div className="hud-tach" ref={rootRef}>
			<svg className="hud-tach__dial" viewBox="-100 -100 200 200" aria-hidden="true">
				<path className="hud-tach__track" d={geometry.track} />
				<path className="hud-tach__redline" d={geometry.redline} />
				<path className="hud-tach__fill" d={geometry.fill} pathLength={1} ref={fillRef} />
				{geometry.ticks.map((tick) => (
					<line
						key={tick.rpm}
						className={`hud-tach__tick${tick.major ? " is-major" : ""}${tick.inRedline ? " is-red" : ""}`}
						x1={tick.inner.x}
						y1={tick.inner.y}
						x2={tick.outer.x}
						y2={tick.outer.y}
					/>
				))}
				{geometry.ticks
					.filter((tick) => tick.label !== null)
					.map((tick) => (
						<text
							key={`l${tick.rpm}`}
							className={`hud-tach__label${tick.inRedline ? " is-red" : ""}`}
							x={tick.labelAt.x}
							y={tick.labelAt.y}
						>
							{tick.label}
						</text>
					))}
				<g className="hud-tach__needle" ref={needleRef}>
					<polygon
						points={`-2.6,${-NEEDLE_INNER} 2.6,${-NEEDLE_INNER} 0.9,${-NEEDLE_OUTER} -0.9,${-NEEDLE_OUTER}`}
					/>
				</g>
				<text className="hud-tach__unit" x={0} y={-45}>
					×1000 rpm
				</text>
			</svg>
			<div className="hud-tach__center">{children}</div>
		</div>
	);
}
