import * as THREE from "three";
import { Vec3, VehicleDefinition } from "../data/vehicles/types";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import VehicleManager from "../managers/VehicleManager";
import VehiclePhysics from "../vehicle/VehiclePhysics";

/** Pose visual de uma roda, interpolada entre os dois últimos passos */
interface WheelPose {
	/** Conexão da suspensão no chassi (m, eixos locais) */
	connectionPoint: THREE.Vector3;
	worldPosition: THREE.Vector3;
	worldQuaternion: THREE.Quaternion;
	/** Esterço (rad) */
	steering: number;
	/** Giro (rad) */
	rotation: number;
	isInContact: boolean;
	/** Comprimento da suspensão (m) */
	suspensionLength: number;
}

/**
 * Meshes de chassi e rodas de um veículo: placeholder, carregamento do modelo,
 * pose interpolada por quadro e liberação na GPU. Só lê a física.
 */
export default class VehicleView {
	static readonly WHEEL_COUNT = 4;
	private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);
	private static readonly AXIS_Z = new THREE.Vector3(0, 0, 1);

	/** Mesh atual do chassi (placeholder até o modelo carregar) */
	mesh!: THREE.Object3D;
	private placeholderMesh!: THREE.Object3D;
	private wheelMeshes: THREE.Object3D[] = [];
	private wheelPoses: WheelPose[] = [];
	private definition!: VehicleDefinition;
	private physics!: VehiclePhysics;
	private loadRequestId = 0;
	private retiredObjects: THREE.Object3D[] = [];

	private tempVector3 = new THREE.Vector3();
	private tempQuaternion = new THREE.Quaternion();
	private tempSteeringQuat = new THREE.Quaternion();
	private tempSpinQuat = new THREE.Quaternion();
	private tempOffset = new THREE.Vector3();
	/** Pose do chassi interpolada entre os dois últimos passos */
	private renderPosition = new THREE.Vector3();
	private renderQuaternion = new THREE.Quaternion();

	constructor(
		private readonly scene: THREE.Scene,
		private readonly physicsWorld: PhysicsWorld,
		private readonly vehicleManager: VehicleManager = new VehicleManager()
	) {}

	/**
	 * Tira as meshes atuais da cena (liberadas no próximo `load`) e cria placeholders (chassi fora da cena, rodas na cena) para o veículo
	 */
	setVehicle(definition: VehicleDefinition, physics: VehiclePhysics): void {
		if (this.mesh) this.retireObjects([this.mesh, ...this.wheelMeshes]);

		this.definition = definition;
		this.physics = physics;
		this.wheelPoses = definition.wheels.adjustments.map((wheel) => ({
			connectionPoint: new THREE.Vector3(wheel.position.x, wheel.position.y, wheel.position.z),
			worldPosition: new THREE.Vector3(),
			worldQuaternion: new THREE.Quaternion(),
			steering: 0,
			rotation: 0,
			isInContact: false,
			suspensionLength: definition.physics.suspensionRestLength,
		}));

		const chassisSize = definition.physics.size;
		const chassisGeometry = new THREE.BoxGeometry(chassisSize.x, chassisSize.y, chassisSize.z);
		const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d1f });
		this.mesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		this.mesh.castShadow = true;
		this.placeholderMesh = this.mesh;

		this.wheelMeshes = [];
		const wheelRadius = definition.physics.wheelRadius;
		const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 32);
		wheelGeometry.rotateX(Math.PI / 2);
		const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

		for (let i = 0; i < VehicleView.WHEEL_COUNT; i++) {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.castShadow = true;
			this.scene.add(wheelMesh);
			this.wheelMeshes.push(wheelMesh);
		}

		// o PhysicsWorld sincroniza o placeholder com o chassi
		this.physicsWorld.addEntity(physics.chassisBody, this.mesh);
	}

	/**
	 * Carrega o modelo do veículo atual; um carregamento superado por outro é descartado.
	 * As meshes anteriores são liberadas depois de o novo carregamento reservar seus modelos,
	 * para que modelos comuns aos dois veículos continuem na GPU.
	 */
	async load(): Promise<void> {
		const definition = this.definition;
		try {
			const requestId = ++this.loadRequestId;
			const loading = this.vehicleManager.loadVehicle(definition, VehicleView.WHEEL_COUNT);
			this.releaseObjects(this.retiredObjects);
			this.retiredObjects = [];
			const vehicleModels = await loading;

			if (requestId !== this.loadRequestId) {
				this.releaseObjects([vehicleModels.body, ...vehicleModels.wheels]);
				return;
			}

			this.releaseObjects([this.mesh, ...this.wheelMeshes]);

			if (vehicleModels.body) {
				this.mesh = vehicleModels.body;
				this.scene.add(this.mesh);
			}

			if (vehicleModels.wheels) {
				this.wheelMeshes = vehicleModels.wheels;
				for (const wheel of this.wheelMeshes) this.scene.add(wheel);
			}
		} catch (error) {
			console.error(`Erro ao carregar veículo ${definition.body.modelPath}:`, error);
		}
	}

	/** Aplica a pose interpolada da física às meshes (por quadro) */
	update(): void {
		this.physicsWorld.getInterpolatedPose(this.physics.chassisBody, this.renderPosition, this.renderQuaternion);
		this.updateWheelPoses(this.physicsWorld.getInterpolationAlpha());
		this.updateChassisMesh();
		this.updateWheelMeshes();
	}

	/** Suspensão, esterço e giro de cada roda interpolados por alpha (0–1) */
	private updateWheelPoses(alpha: number): void {
		for (let i = 0; i < this.wheelPoses.length; i++) {
			const pose = this.wheelPoses[i];
			const previous = this.physics.wheels[i];

			pose.isInContact = this.physics.wheelIsInContact(i);
			pose.suspensionLength = THREE.MathUtils.lerp(previous.previousSuspensionLength, this.physics.wheelSuspensionLength(i), alpha);
			pose.steering = THREE.MathUtils.lerp(previous.previousSteering, this.physics.wheelSteering(i), alpha);
			pose.rotation = THREE.MathUtils.lerp(previous.previousRotation, this.physics.wheelRotation(i), alpha);

			this.calculateWheelWorldTransform(pose);
		}
	}

	private calculateWheelWorldTransform(pose: WheelPose): void {
		const chassisPos = this.renderPosition;
		this.tempQuaternion.copy(this.renderQuaternion);

		this.tempVector3.copy(pose.connectionPoint);
		this.tempVector3.y -= pose.suspensionLength;

		this.tempVector3.applyQuaternion(this.tempQuaternion);
		this.tempVector3.x += chassisPos.x;
		this.tempVector3.y += chassisPos.y;
		this.tempVector3.z += chassisPos.z;

		pose.worldPosition.copy(this.tempVector3);

		this.tempSteeringQuat.setFromAxisAngle(VehicleView.AXIS_Y, pose.steering);
		this.tempSpinQuat.setFromAxisAngle(VehicleView.AXIS_Z, -pose.rotation);

		pose.worldQuaternion.copy(this.tempQuaternion);
		pose.worldQuaternion.multiply(this.tempSteeringQuat);
		pose.worldQuaternion.multiply(this.tempSpinQuat);
	}

	private updateChassisMesh(): void {
		if (this.mesh && this.mesh !== this.placeholderMesh) {
			this.fixCarAlignment(this.mesh, this.renderPosition, this.renderQuaternion, this.definition.body);
		}
	}

	private updateWheelMeshes(): void {
		for (let i = 0; i < this.wheelPoses.length; i++) {
			this.fixWheelAlignment(i, this.wheelMeshes[i], this.wheelPoses[i], this.definition.wheels.adjustments[i] ?? null);
		}
	}

	/** Pose do chassi mais o ajuste do modelo (posição em eixos locais, rotação em rad) */
	private fixCarAlignment(carMesh: THREE.Object3D, position: THREE.Vector3, rotation: THREE.Quaternion, adjustments: { position: Vec3; rotation: Vec3 }): void {
		carMesh.position.copy(position);
		carMesh.quaternion.copy(rotation);

		const localOffset = this.tempOffset.set(adjustments.position.x, adjustments.position.y, adjustments.position.z);
		localOffset.applyQuaternion(carMesh.quaternion);
		carMesh.position.add(localOffset);

		carMesh.rotateX(adjustments.rotation.x);
		carMesh.rotateY(adjustments.rotation.y);
		carMesh.rotateZ(adjustments.rotation.z);
	}

	private fixWheelAlignment(wheelIndex: number, wheelMesh: THREE.Object3D, pose: WheelPose, adjustments: { rotation: Vec3 } | null): void {
		wheelMesh.position.copy(pose.worldPosition);
		wheelMesh.quaternion.copy(pose.worldQuaternion);

		// rodas do lado direito (índices ímpares) espelhadas
		if (wheelIndex % 2 === 1) {
			wheelMesh.rotateY(Math.PI);
		}

		if (adjustments) {
			wheelMesh.rotateX(adjustments.rotation.x);
			wheelMesh.rotateY(adjustments.rotation.y);
			wheelMesh.rotateZ(adjustments.rotation.z);
		}
	}

	private retireObjects(objects: THREE.Object3D[]): void {
		for (const object of objects) {
			object.removeFromParent();
			this.retiredObjects.push(object);
		}
	}

	/** Remove objetos da cena e libera geometrias, materiais e texturas que não pertencem ao cache de modelos */
	private releaseObjects(objects: THREE.Object3D[]): void {
		this.vehicleManager.releaseObjects(objects);
	}
}
