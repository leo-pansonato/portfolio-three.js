import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsBody, QuatLike, Vec3Like } from "./PhysicsWorld";

/**
 * PhysicsBody sobre um RigidBody da Rapier; o objeto WASM pertence ao RapierPhysicsWorld
 */
export default class RapierBody implements PhysicsBody {
	constructor(readonly raw: RAPIER.RigidBody) {}

	getPosition<T extends Vec3Like>(out: T): T {
		const position = this.raw.translation();
		out.x = position.x;
		out.y = position.y;
		out.z = position.z;
		return out;
	}

	getRotation<T extends QuatLike>(out: T): T {
		const rotation = this.raw.rotation();
		out.x = rotation.x;
		out.y = rotation.y;
		out.z = rotation.z;
		out.w = rotation.w;
		return out;
	}

	getLinearVelocity<T extends Vec3Like>(out: T): T {
		const velocity = this.raw.linvel();
		out.x = velocity.x;
		out.y = velocity.y;
		out.z = velocity.z;
		return out;
	}

	setPosition(position: Vec3Like): void {
		this.raw.setTranslation(position, true);
	}

	setRotation(rotation: QuatLike): void {
		this.raw.setRotation(rotation, true);
	}

	setLinearVelocity(velocity: Vec3Like): void {
		this.raw.setLinvel(velocity, true);
	}

	setAngularVelocity(velocity: Vec3Like): void {
		this.raw.setAngvel(velocity, true);
	}
}
