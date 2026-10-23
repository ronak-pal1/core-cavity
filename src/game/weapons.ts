import { Fn, float, sin, time, uniform, vec3, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { beamColor } from './materials';

interface Explosion {
  mesh: THREE.Mesh;
  opacity: UniformNode<'float', number>;
  life: number;
  max: number;
  radius: number;
  x: number;
  y: number;
  z: number;
}

export interface ExplosionLight {
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
}

export class Weapons {
  cooldown = 0;
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly end = new THREE.Vector3();
  private readonly explosions: Explosion[] = [];

  constructor(scene: THREE.Scene) {
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), beamColor(true));
    this.glow = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 8), beamColor(false));
    for (const beam of [this.core, this.glow]) {
      beam.frustumCulled = false;
      beam.visible = false;
      beam.renderOrder = 2;
      scene.add(beam);
    }
    for (let i = 0; i < 6; i++) {
      const opacity = uniform(0);
      const material = new THREE.MeshBasicNodeMaterial();
      material.transparent = true;
      material.depthWrite = false;
      material.blending = THREE.AdditiveBlending;
      material.side = THREE.DoubleSide;
      material.toneMapped = false;
      material.colorNode = Fn(() => {
        const pulse = float(0.75).add(sin(time.mul(24)).mul(0.25));
        return vec4(vec3(1, 0.48, 0.12).mul(pulse).mul(2.4), opacity);
      })();
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.explosions.push({ mesh, opacity, life: 0, max: 0.45, radius: 1, x: 0, y: 0, z: 0 });
    }
  }

  setLaser(from: THREE.Vector3 | null, to: THREE.Vector3 | null): void {
    if (!from || !to) {
      this.core.visible = false;
      this.glow.visible = false;
      return;
    }
    this.end.copy(to).sub(from);
    const length = this.end.length();
    if (length < 0.05) {
      this.core.visible = false;
      this.glow.visible = false;
      return;
    }
    this.end.multiplyScalar(1 / length);
    for (const beam of [this.core, this.glow]) {
      beam.visible = true;
      beam.scale.set(1, length, 1);
      beam.position.copy(from).addScaledVector(this.end, length * 0.5);
      beam.quaternion.setFromUnitVectors(Y_AXIS, this.end);
    }
  }

  blast(x: number, y: number, z: number, radius: number): void {
    const slot = this.explosions.reduce((best, explosion) => (explosion.life < best.life ? explosion : best));
    slot.life = 0.48;
    slot.max = 0.48;
    slot.radius = radius;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const explosion of this.explosions) {
      if (explosion.life <= 0) {
        explosion.mesh.visible = false;
        continue;
      }
      explosion.life -= dt;
      const k = Math.max(0, explosion.life / explosion.max);
      const scale = explosion.radius * (0.35 + (1 - k) * 2.15);
      explosion.mesh.scale.setScalar(Math.max(0.05, scale));
      explosion.opacity.value = k;
      explosion.mesh.visible = explosion.life > 0;
    }
  }

  explosionLights(): ExplosionLight[] {
    const lights: ExplosionLight[] = [];
    for (const explosion of this.explosions) {
      if (explosion.life <= 0) continue;
      const k = explosion.life / explosion.max;
      lights.push({
        x: explosion.x,
        y: explosion.y,
        z: explosion.z,
        radius: explosion.radius * 2.4,
        intensity: 11 * k,
      });
    }
    return lights;
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
