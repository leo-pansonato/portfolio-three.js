import { CameraMode, VehicleDefinition } from "./types";

export const bmwF82: VehicleDefinition = {
	body: {
		modelPath: "/assets/models/bmw_m4_f82/scene.gltf",
		scale: { x: 1, y: 1, z: 1 },
		position: { x: 0.2, y: -0.66, z: 0 },
		rotation: { x: 0, y: Math.PI / 2, z: 0 },
		materials: {
			glass: {
				castShadow: false,
				receiveShadow: false,
			},
		},
	},
	physics: {
		mass: 1550,
		size: { x: 4.6, y: 1.2, z: 1.8 },
		wheelRadius: 0.33,
		suspensionStiffness: 30,
		suspensionRestLength: 0.52,
		maxSuspensionTravel: 0.4,
		maxSuspensionForce: 100000,
		suspensionCompression: 3.2,
		suspensionRelaxation: 1.6,
		frictionSlip: 2.0,
		sideFrictionStiffness: 1.0,
	},
	cameraSettings: {
		[CameraMode.THIRD_PERSON]: {
			distance: 5,
			height: 1.6,
			fov: 60,
			lerpSpeed: 0.1,
			lookAtOffset: { y: 1, x: 0, z: 0 },
		},
		[CameraMode.HOOD]: {
			fov: 80,
			lerpSpeed: 0.2,
			offset: { x: 0, y: 1, z: 1.3 },
			distance: 0,
			height: 0,
			lookAtOffset: { y: 0 },
		},
		[CameraMode.FIRST_PERSON]: {
			fov: 70,
			lerpSpeed: 0.3,
			offset: { x: 0.36, y: 1.04, z: -0.3 },
			distance: 0,
			height: 0,
			lookAtOffset: { y: 0 },
		},
	},
	configs: {
		maxSpeed: 20,
		maxForce: 5000,
		maxBoostForce: 3,
		brakeForce: 3600,
		rollingResistance: 93,
		eBrakeForce: 3300,
		maxSteerVal: 0.5,
		steerSpeed: 1.3,
		steerReturn: 2.0,
		tractionDisplacement: "rear",
	},
	wheels: {
		modelPath: "/assets/models/wheel/scene.gltf",
		scale: { x: 0.85, y: 0.85, z: 0.85 },
		adjustments: [
			{ position: { x: 1.494, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: 1.494, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: -1.328, y: 0, z: -0.81 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: -1.328, y: 0, z: 0.81 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
		],
	},
};
