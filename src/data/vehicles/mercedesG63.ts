import { CameraMode, VehicleDefinition } from "./types";

export const mercedesG63: VehicleDefinition = {
	body: {
		modelPath: "/assets/models/mercedes_g63/scene.gltf",
		scale: { x: 1, y: 1, z: 1 },
		position: { x: 0, y: -0.66, z: 0 },
		rotation: { x: 0, y: Math.PI / 2, z: 0 },
		materials: {
			body: {
				castShadow: false,
				receiveShadow: false,
			},
		},
	},
	physics: {
		mass: 2500,
		size: { x: 4.6, y: 1.2, z: 1.8 },
		wheelRadius: 0.38,
		suspensionStiffness: 25,
		suspensionRestLength: 0.8,
		maxSuspensionTravel: 0.8,
		maxSuspensionForce: 100000,
		suspensionCompression: 3.2,
		suspensionRelaxation: 1.6,
		frictionSlip: 1.4,
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
			fov: 75,
			lerpSpeed: 0.2,
			offset: { x: 0, y: 1.08, z: 1.3 },
			distance: 0,
			height: 0,
			lookAtOffset: { y: 0 },
		},
		[CameraMode.FIRST_PERSON]: {
			fov: 90,
			lerpSpeed: 0.3,
			offset: { x: 0.4, y: 1.2, z: -0.16 },
			distance: 0,
			height: 0,
			lookAtOffset: { y: 0 },
		},
	},
	configs: {
		maxSpeed: 20,
		maxForce: 3500,
		maxBoostForce: 3,
		brakeForce: 5700,
		rollingResistance: 75,
		eBrakeForce: 3900,
		maxSteerVal: 0.5,
		steerSpeed: 2.0,
		steerReturn: 2.0,
		tractionDisplacement: "all",
	},
	wheels: {
		modelPath: "/assets/models/wheel/scene.gltf",
		scale: { x: 1, y: 1, z: 1 },
		adjustments: [
			{ position: { x: 1.48, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: 1.48, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: -1.29, y: 0, z: -0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
			{ position: { x: -1.29, y: 0, z: 0.8 }, rotation: { x: -Math.PI / 2, y: 0, z: Math.PI / 2 } },
		],
	},
};
