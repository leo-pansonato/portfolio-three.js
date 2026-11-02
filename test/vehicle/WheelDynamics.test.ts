import { describe, expect, it } from "vitest";
import { VehicleTireConfig } from "../../src/data/vehicles/types";
import Tire, { magicFormula } from "../../src/vehicle/Tire";
import WheelDynamics, { createWheelState, WheelState, WheelStepInput } from "../../src/vehicle/WheelDynamics";

const DT = 1 / 60; // s
const RADIUS = 0.33; // m
const INERTIA = 1.3; // kg·m²
const LOAD = 4000; // N
const MASS = 400; // kg, quarto do carro
const CONFIG: VehicleTireConfig = {
	longitudinal: { stiffness: 24, shape: 1.3, peakFriction: 1.1, curvature: 0 },
	lateral: { stiffness: 19, shape: 1.3, peakFriction: 1.0, curvature: 0 },
	lowSpeedThreshold: 1,
};
const tire = new Tire(CONFIG);
const dynamics = new WheelDynamics(tire, RADIUS);

function input(values: Partial<WheelStepInput>): WheelStepInput {
	return {
		longitudinalSpeed: 0,
		lateralSpeed: 0,
		normalLoad: LOAD,
		driveTorque: 0,
		brakeTorque: 0,
		inertia: INERTIA,
		longitudinalContactMass: 0,
		lateralContactMass: 0,
		...values,
	};
}

/** Roda num quarto de carro de massa `MASS` em linha reta: o contato acelera com a força do pneu */
function quarterCar(wheel: WheelState, values: Partial<WheelStepInput>, seconds: number, dt = DT) {
	const step = input({ longitudinalContactMass: MASS, lateralContactMass: MASS, ...values });
	const history: { v: number; omega: number; fx: number; vy: number; fy: number }[] = [];
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		dynamics.step(wheel, step, dt);
		step.longitudinalSpeed += (wheel.longitudinalForce * dt) / MASS;
		step.lateralSpeed += (wheel.lateralForce * dt) / MASS;
		history.push({
			v: step.longitudinalSpeed,
			omega: wheel.angularVelocity,
			fx: wheel.longitudinalForce,
			vy: step.lateralSpeed,
			fy: wheel.lateralForce,
		});
	}
	return history;
}

describe("WheelDynamics — roda e pneu", () => {
	it("rolando livre sem torque: sem força e velocidade angular constante", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		dynamics.step(wheel, input({ longitudinalSpeed: 20 }), DT);

		expect(wheel.slipRatio).toBeCloseTo(0, 12);
		expect(wheel.longitudinalForce).toBeCloseTo(0, 9);
		expect(wheel.lateralForce).toBeCloseTo(0, 9);
		expect(wheel.angularVelocity).toBeCloseTo(20 / RADIUS, 9);
		expect(wheel.rotation).toBeCloseTo((20 / RADIUS) * DT, 9);
	});

	it("torque abaixo da aderência: converge para r·Fx = T sem oscilar, no escorregamento da curva", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		const torque = 0.5 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		const forces: number[] = [];
		for (let i = 0; i < 30; i++) {
			dynamics.step(wheel, input({ longitudinalSpeed: 20, driveTorque: torque }), DT);
			forces.push(wheel.longitudinalForce);
		}
		for (let i = 1; i < forces.length; i++) expect(forces[i]).toBeGreaterThanOrEqual(forces[i - 1] - 1e-6);
		expect(forces[29] * RADIUS).toBeCloseTo(torque, 0);
		expect(wheel.slipRatio).toBeGreaterThan(0);
		expect(wheel.slipRatio).toBeLessThan(tire.peakSlipRatio);
	});

	it("torque acima da aderência: a roda dispara (escorregamento passa do pico) e Fx ≤ μ·Fz", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		const torque = 2 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		for (let i = 0; i < 60; i++) {
			dynamics.step(wheel, input({ longitudinalSpeed: 20, driveTorque: torque }), DT);
			expect(wheel.longitudinalForce).toBeLessThanOrEqual(CONFIG.longitudinal.peakFriction * LOAD + 1e-9);
		}
		expect(wheel.slipRatio).toBeGreaterThan(5 * tire.peakSlipRatio);
	});

	it("freio maior que o torque do pneu trava a roda sem inverter o giro; força de deslizamento oposta", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		const brake = 2 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		for (let i = 0; i < 30; i++) {
			dynamics.step(wheel, input({ longitudinalSpeed: 20, brakeTorque: brake }), DT);
			expect(wheel.angularVelocity).toBeGreaterThanOrEqual(0);
		}
		expect(wheel.angularVelocity).toBe(0);
		expect(wheel.slipRatio).toBe(-1);
		const sliding = CONFIG.longitudinal.peakFriction * LOAD * magicFormula(CONFIG.longitudinal, 1);
		expect(wheel.longitudinalForce).toBeCloseTo(-sliding, 0);
	});

	it("freio abaixo do travamento: roda gira com escorregamento negativo e r·|Fx| = torque do freio", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		const brake = 0.6 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		for (let i = 0; i < 60; i++) dynamics.step(wheel, input({ longitudinalSpeed: 20, brakeTorque: brake }), DT);

		expect(wheel.angularVelocity).toBeGreaterThan(0);
		expect(wheel.slipRatio).toBeLessThan(0);
		expect(wheel.slipRatio).toBeGreaterThan(-tire.peakSlipRatio);
		expect(-wheel.longitudinalForce * RADIUS).toBeCloseTo(brake, 0);
	});

	it("no ar: torque acelera pela inércia; freio para a roda sem inverter", () => {
		const wheel = createWheelState();
		dynamics.step(wheel, input({ normalLoad: 0, driveTorque: 130 }), DT);
		expect(wheel.angularVelocity).toBeCloseTo((130 / INERTIA) * DT, 12);
		expect(wheel.longitudinalForce).toBe(0);
		expect(wheel.lateralForce).toBe(0);

		wheel.angularVelocity = 5;
		dynamics.step(wheel, input({ normalLoad: 0, brakeTorque: 130 }), DT);
		expect(wheel.angularVelocity).toBeCloseTo(5 - (130 / INERTIA) * DT, 12);
		for (let i = 0; i < 10; i++) dynamics.step(wheel, input({ normalLoad: 0, brakeTorque: 130 }), DT);
		expect(wheel.angularVelocity).toBe(0);
	});

	it("parado com freio: continua parado, sem força nem giro", () => {
		const wheel = createWheelState();
		dynamics.step(wheel, input({ brakeTorque: 30, longitudinalContactMass: MASS, lateralContactMass: MASS }), DT);
		expect(wheel.angularVelocity).toBe(0);
		expect(Math.abs(wheel.longitudinalForce)).toBe(0);
		expect(wheel.slipRatio).toBe(0);
	});
});

describe("WheelDynamics — estabilidade no quarto de carro", () => {
	it("deslizando de lado parado: a força lateral leva vy a zero sem trocar de sinal", () => {
		const wheel = createWheelState();
		const history = quarterCar(wheel, { lateralSpeed: 0.5 }, 1);
		for (const h of history) {
			expect(h.vy).toBeGreaterThanOrEqual(-1e-9);
			expect(Math.abs(h.fy)).toBeLessThanOrEqual(CONFIG.lateral.peakFriction * LOAD + 1e-9);
		}
		expect(Math.abs(history[history.length - 1].vy)).toBeLessThan(1e-3);
	});

	it("arrancada com torque acima da aderência: velocidade cresce monotonicamente, finita, Fx ≤ μ·Fz", () => {
		const wheel = createWheelState();
		const torque = 1.5 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		const history = quarterCar(wheel, { driveTorque: torque }, 3);
		for (let i = 1; i < history.length; i++) {
			expect(Number.isFinite(history[i].omega)).toBe(true);
			expect(history[i].v).toBeGreaterThanOrEqual(history[i - 1].v - 1e-9);
			expect(history[i].fx).toBeLessThanOrEqual(CONFIG.longitudinal.peakFriction * LOAD + 1e-9);
		}
		const accel = history[history.length - 1].v / 3;
		expect(accel).toBeGreaterThan((0.8 * (CONFIG.longitudinal.peakFriction * LOAD)) / MASS);
	});

	it("arrancada com torque moderado: aceleração ≈ T/r/(m + I/r²), igual com passo de 1/60 e 1/240 s", () => {
		const torque = 0.4 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		const at60 = quarterCar(createWheelState(), { driveTorque: torque }, 2, 1 / 60);
		const at240 = quarterCar(createWheelState(), { driveTorque: torque }, 2, 1 / 240);
		const v60 = at60[at60.length - 1].v;
		const v240 = at240[at240.length - 1].v;
		const expected = (torque / RADIUS / (MASS + INERTIA / (RADIUS * RADIUS))) * 2;

		expect(Math.abs(v60 / expected - 1)).toBeLessThan(0.03);
		expect(Math.abs(v60 / v240 - 1)).toBeLessThan(0.01);
	});

	it("frenagem até parar: para sem inverter o sentido e sem tremer parado", () => {
		const wheel = createWheelState();
		wheel.angularVelocity = 20 / RADIUS;
		const brake = 0.8 * CONFIG.longitudinal.peakFriction * LOAD * RADIUS;
		const history = quarterCar(wheel, { longitudinalSpeed: 20, brakeTorque: brake }, 5);
		for (const h of history) {
			expect(h.v).toBeGreaterThanOrEqual(-1e-6);
			expect(h.omega).toBeGreaterThanOrEqual(0);
		}
		const tail = history.slice(-60);
		for (const h of tail) {
			expect(Math.abs(h.v)).toBeLessThan(1e-6);
			expect(h.omega).toBe(0);
		}
	});
});
