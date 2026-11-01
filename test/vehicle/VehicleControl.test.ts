import { describe, expect, it } from "vitest";
import { VehicleDrivingConfig } from "../../src/data/vehicles/types";
import VehicleControl, { createDriverInput, DriverInput } from "../../src/vehicle/VehicleControl";
import { createVehicleState } from "../../src/vehicle/VehicleState";

const DT = 1 / 60; // s

const CONFIG: VehicleDrivingConfig = Object.freeze({
	maxSpeed: 20,
	maxForce: 4000, // N
	maxBoostForce: 3,
	brakeForce: 3000, // N
	rollingResistance: 80, // N
	eBrakeForce: 2500, // N
	maxSteerVal: 0.5, // rad
	steerSpeed: 1, // rad/s
	steerReturn: 2, // rad/s
	tractionDisplacement: "rear",
});

function setup() {
	const state = createVehicleState();
	const control = new VehicleControl(CONFIG, state);
	const input = createDriverInput();
	const run = (steps: number, forwardSpeed = 0) => {
		for (let i = 0; i < steps; i++) control.step(input, forwardSpeed, DT);
		return control.commands;
	};
	return { state, control, input, run };
}

function inputOf(values: Partial<DriverInput>): DriverInput {
	return Object.assign(createDriverInput(), values);
}

describe("VehicleControl — volante", () => {
	it("rampa até o esterço máximo na velocidade do volante; esquerda é ângulo positivo", () => {
		const { input, run } = setup();
		input.steer = -1;

		expect(run(15).steeringAngle).toBeCloseTo(CONFIG.steerSpeed * 15 * DT, 10);
		expect(run(60).steeringAngle).toBe(CONFIG.maxSteerVal);

		input.steer = 1;
		expect(run(120).steeringAngle).toBe(-CONFIG.maxSteerVal);
	});

	it("rampa mais lenta em velocidade (50 m/s → 75%)", () => {
		const { input, run } = setup();
		input.steer = -1;

		expect(run(15, 50).steeringAngle).toBeCloseTo(0.75 * CONFIG.steerSpeed * 15 * DT, 10);
	});

	it("volta ao centro sem passar do zero", () => {
		const { state, input, run } = setup();
		input.steer = -1;
		run(60);
		input.steer = 0;

		expect(run(6).steeringAngle).toBeCloseTo(CONFIG.maxSteerVal - CONFIG.steerReturn * 6 * DT, 10);
		expect(run(60).steeringAngle).toBe(0);
		expect(state.steeringAngle).toBe(0);
	});
});

describe("VehicleControl — motor e freio", () => {
	it("acelerador proporcional; boost multiplica a força e volta a 1 ao soltar", () => {
		const control = new VehicleControl(CONFIG, createVehicleState());

		expect(control.step(inputOf({ throttle: 0.5 }), 10, DT).engineForce).toBe(2000);
		expect(control.step(inputOf({ throttle: 1, boost: true }), 10, DT).engineForce).toBe(12000);
		expect(control.step(inputOf({ throttle: 1 }), 10, DT).engineForce).toBe(4000);
	});

	it("freio quase parado e sem acelerador engata a ré", () => {
		const control = new VehicleControl(CONFIG, createVehicleState());

		const stopped = control.step(inputOf({ brake: 1 }), 1.9, DT);
		expect(stopped.engineForce).toBe(-CONFIG.maxForce);
		expect(stopped.brakeForce).toBe(0);

		// já em ré (velocidade negativa) continua acelerando para trás
		expect(control.step(inputOf({ brake: 0.5 }), -5, DT).engineForce).toBe(-CONFIG.maxForce * 0.5);
	});

	it("freio em movimento freia, sem ré", () => {
		const control = new VehicleControl(CONFIG, createVehicleState());

		const moving = control.step(inputOf({ brake: 1 }), 2, DT);
		expect(moving.engineForce).toBe(0);
		expect(moving.brakeForce).toBe(CONFIG.brakeForce);

		// acelerador junto com freio também não engata a ré
		const both = control.step(inputOf({ throttle: 1, brake: 1 }), 0, DT);
		expect(both.engineForce).toBe(CONFIG.maxForce);
		expect(both.brakeForce).toBe(CONFIG.brakeForce);
	});

	it("sem acelerador nem freio aplica a resistência ao rolamento", () => {
		const control = new VehicleControl(CONFIG, createVehicleState());

		const idle = control.step(createDriverInput(), 15, DT);
		expect(idle.engineForce).toBe(0);
		expect(idle.brakeForce).toBe(CONFIG.rollingResistance);
		expect(idle.handbrakeForce).toBe(0);
	});

	it("freio de mão independe do freio", () => {
		const control = new VehicleControl(CONFIG, createVehicleState());

		const handbrake = control.step(inputOf({ throttle: 1, handbrake: true }), 15, DT);
		expect(handbrake.handbrakeForce).toBe(CONFIG.eBrakeForce);
		expect(handbrake.brakeForce).toBe(0);
	});
});

describe("VehicleControl — estado por instância", () => {
	it("duas instâncias com a mesma definição não compartilham estado", () => {
		const a = setup();
		const b = new VehicleControl(CONFIG, createVehicleState());
		a.input.steer = -1;
		a.run(30, 12);

		expect(a.state.steeringAngle).toBeGreaterThan(0);
		expect(a.state.forwardSpeed).toBe(12);
		expect(b.step(createDriverInput(), 0, DT).steeringAngle).toBe(0);
	});
});
