import * as THREE from 'three/webgpu';
import { PLAYER_RADIUS, type RayHit, type Vec3 } from './types';
import type { VoxelGrid } from './voxelGrid';

export interface MoveInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
}

export interface RigMaterials {
  hull: THREE.Material;
  engine: THREE.Material;
  glass: THREE.Material;
}

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly rig: THREE.Group;
  yaw = 0.6;
  pitch = 0.38;
  health = 100;
  fuel = 100;
  tier = 1;
  moving = false;
  boosting = false;
  touchingLava = false;
  thrust = 0.2;
  private roll = 0;
  private age = 0;
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly wish = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly cameraDir = new THREE.Vector3();
  private readonly ray: RayHit = { x: 0, y: 0, z: 0, distance: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 };
  private readonly muzzleLocal = new THREE.Vector3(0, -0.05, -0.98);
  private readonly shakeOffset = new THREE.Vector3();

  constructor(scene: THREE.Scene, materials: RigMaterials) {
    this.rig = buildRig(materials);
    scene.add(this.rig);
  }

  reset(spawn: Vec3, tier: number): void {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.fuel = 100;
    this.tier = tier;
    this.pitch = 0.42;
    this.roll = 0;
    this.thrust = 0.15;
    this.moving = false;
    this.boosting = false;
    this.touchingLava = false;
    this.syncRig(0);
  }

  addLook(yawDelta: number, pitchDelta: number): void {
    this.yaw -= yawDelta;
    this.pitch = Math.max(-1.15, Math.min(1.15, this.pitch - pitchDelta));
  }

  move(dt: number, input: MoveInput, grid: VoxelGrid): void {
    this.updateBasis();
    this.wish.set(0, 0, 0);
    if (input.forward) this.wish.add(this.forward);
    if (input.back) this.wish.sub(this.forward);
    if (input.right) this.wish.add(this.right);
    if (input.left) this.wish.sub(this.right);
    if (input.up) this.wish.add(this.up);
    if (input.down) this.wish.sub(this.up);
    this.moving = this.wish.lengthSq() > 1e-6;
    if (this.moving) this.wish.normalize();
    this.boosting = input.boost && this.moving && this.fuel > 4;
    const speed = this.boosting ? 12.6 : 7.15;
    this.target.copy(this.wish).multiplyScalar(this.moving ? speed : 0);
    this.velocity.lerp(this.target, 1 - Math.exp(-20 * dt));
    this.position.addScaledVector(this.velocity, dt);
    this.touchingLava = grid.resolveSphere(this.position, PLAYER_RADIUS);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetRoll = -strafe * 0.16;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-8 * dt));
    this.age += dt;
    const thrustTarget = Math.min(1, this.velocity.length() / 12);
    this.thrust += (thrustTarget - this.thrust) * (1 - Math.exp(-6 * dt));
  }

  syncCamera(camera: THREE.PerspectiveCamera, grid: VoxelGrid, shake: number): void {
    this.updateBasis();
    this.head.copy(this.position).addScaledVector(this.up, 0.28);
    this.desired.copy(this.head).addScaledVector(this.forward, -3.65).addScaledVector(this.up, 0.78);
    this.cameraDir.copy(this.desired).sub(this.head);
    const distance = this.cameraDir.length();
    if (distance > 0.001) {
      this.cameraDir.multiplyScalar(1 / distance);
      const blocked = grid.raycast(this.head.x, this.head.y, this.head.z, this.cameraDir.x, this.cameraDir.y, this.cameraDir.z, distance, this.ray);
      if (blocked && this.ray.distance < distance) {
        const pull = Math.max(0.32, this.ray.distance - 0.3);
        camera.position.copy(this.head).addScaledVector(this.cameraDir, pull);
      } else {
        camera.position.copy(this.desired);
      }
    } else {
      camera.position.copy(this.desired);
    }
    if (shake > 0) {
      this.shakeOffset.set((Math.random() - 0.5) * shake * 0.38, (Math.random() - 0.5) * shake * 0.28, (Math.random() - 0.5) * shake * 0.38);
      camera.position.add(this.shakeOffset);
    }
    camera.quaternion.copy(this.quaternion);
    this.syncRig(shake);
    this.rig.visible = camera.position.distanceTo(this.position) > 1.15;
  }

  getMuzzle(target: THREE.Vector3): THREE.Vector3 {
    this.rig.updateMatrixWorld(true);
    target.copy(this.muzzleLocal).applyMatrix4(this.rig.matrixWorld);
    return target;
  }

  applyDamage(amount: number): number {
    if (amount <= 0 || this.health <= 0) return 0;
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    return dealt;
  }

  refill(fuel: number, health: number): void {
    this.fuel = Math.min(100, this.fuel + fuel);
    this.health = Math.min(100, this.health + health);
  }

  private updateBasis(): void {
    this.euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.quaternion.setFromEuler(this.euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  private syncRig(shake: number): void {
    this.rig.position.copy(this.position);
    this.rig.position.y += Math.sin(this.age * 2.5) * 0.035;
    if (shake > 0) this.rig.position.x += (Math.random() - 0.5) * shake * 0.08;
    this.rig.quaternion.copy(this.quaternion);
  }
}

function buildRig(materials: RigMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mining-rig';
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.26, 1.18), materials.hull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 5), materials.hull);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -0.76;
  const pontoonL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.72), materials.hull);
  pontoonL.position.set(-0.42, -0.12, 0.05);
  const pontoonR = pontoonL.clone();
  pontoonR.position.x = 0.42;
  const cannonL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.062, 0.74, 8), materials.engine);
  cannonL.rotation.x = Math.PI / 2;
  cannonL.position.set(-0.22, -0.03, -0.55);
  const cannonR = cannonL.clone();
  cannonR.position.x = 0.22;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), materials.glass);
  dome.scale.y = 0.72;
  dome.position.set(0, 0.18, -0.02);
  const engineL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), materials.engine);
  engineL.position.set(-0.22, 0, 0.64);
  const engineR = engineL.clone();
  engineR.position.x = 0.22;
  const glowL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), materials.engine);
  glowL.position.set(-0.22, 0, 0.8);
  const glowR = glowL.clone();
  glowR.position.x = 0.22;
  group.add(hull, nose, pontoonL, pontoonR, cannonL, cannonR, dome, engineL, engineR, glowL, glowR);
  return group;
}
