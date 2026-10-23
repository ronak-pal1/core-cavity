import {
  Fn,
  If,
  abs,
  clamp,
  cos,
  float,
  hash,
  instanceIndex,
  instancedArray,
  sin,
  smoothstep,
  time,
  uint,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { StorageBufferNode } from 'three/webgpu';
import { AMBIENT_PARTICLES, PARTICLE_COUNT } from './types';

export class ParticleSystem {
  readonly sprite: THREE.Sprite;
  private readonly positions: StorageBufferNode<'vec3'>;
  private readonly velocities: StorageBufferNode<'vec3'>;
  private readonly colors: StorageBufferNode<'vec3'>;
  private readonly life: StorageBufferNode<'float'>;
  private readonly duration: StorageBufferNode<'float'>;
  private readonly spawnPos: StorageBufferNode<'vec4'>;
  private readonly spawnVel: StorageBufferNode<'vec4'>;
  private readonly spawnCol: StorageBufferNode<'vec4'>;
  private readonly tokenUniform = uniform(-1);
  private readonly simDt = uniform(0.016);
  private readonly playerPos = uniform(new THREE.Vector3());
  private readonly initCompute;
  private readonly updateCompute;
  private cursor = AMBIENT_PARTICLES;
  private token = 1;
  private pending = false;

  constructor(scene: THREE.Scene) {
    this.positions = instancedArray(PARTICLE_COUNT, 'vec3');
    this.velocities = instancedArray(PARTICLE_COUNT, 'vec3');
    this.colors = instancedArray(PARTICLE_COUNT, 'vec3');
    this.life = instancedArray(PARTICLE_COUNT, 'float');
    this.duration = instancedArray(PARTICLE_COUNT, 'float');
    this.spawnPos = instancedArray(PARTICLE_COUNT, 'vec4').toReadOnly();
    this.spawnVel = instancedArray(PARTICLE_COUNT, 'vec4').toReadOnly();
    this.spawnCol = instancedArray(PARTICLE_COUNT, 'vec4').toReadOnly();

    const positions = this.positions;
    const velocities = this.velocities;
    const colors = this.colors;
    const life = this.life;
    const duration = this.duration;
    const spawnPos = this.spawnPos;
    const spawnVel = this.spawnVel;
    const spawnCol = this.spawnCol;
    const token = this.tokenUniform;
    const simDt = this.simDt;
    const playerPos = this.playerPos;

    this.initCompute = Fn(() => {
      positions.element(instanceIndex).assign(vec3(0, -50, 0));
      velocities.element(instanceIndex).assign(vec3(0, 0, 0));
      colors.element(instanceIndex).assign(vec3(0.4, 0.7, 1));
      life.element(instanceIndex).assign(0);
      duration.element(instanceIndex).assign(1);
    })().compute(PARTICLE_COUNT);

    this.updateCompute = Fn(() => {
      const index = instanceIndex;
      const pos = positions.element(index);
      const vel = velocities.element(index);
      const lifeN = life.element(index);

      If(abs(spawnVel.element(index).w.sub(token)).lessThan(0.5), () => {
        const spawned = spawnPos.element(index);
        pos.assign(spawned.xyz);
        vel.assign(spawnVel.element(index).xyz);
        colors.element(index).assign(spawnCol.element(index).xyz);
        lifeN.assign(1);
        duration.element(index).assign(spawned.w.max(0.12));
      });

      If(index.lessThan(uint(AMBIENT_PARTICLES)), () => {
        lifeN.subAssign(simDt.mul(0.12));
        pos.addAssign(vel.mul(simDt));
        If(lifeN.lessThanEqual(0).or(pos.distance(playerPos).greaterThan(24)), () => {
          const seed = float(index).add(time);
          const angle = hash(seed).mul(6.28318);
          const radius = hash(seed.add(4.2)).mul(9).add(2);
          const yOff = hash(seed.add(9.1)).mul(7).sub(3.5);
          pos.assign(vec3(playerPos.x.add(cos(angle).mul(radius)), playerPos.y.add(yOff), playerPos.z.add(sin(angle).mul(radius))));
          vel.assign(vec3(cos(angle).mul(0.45), hash(seed.add(2.2)).sub(0.5).mul(0.35), sin(angle).mul(0.45)));
          colors.element(index).assign(vec3(0.35, 0.72, 1).mul(hash(seed.add(1.3)).mul(0.45).add(0.25)));
          lifeN.assign(1);
        });
      }).Else(() => {
        If(lifeN.greaterThan(0), () => {
          lifeN.subAssign(simDt.div(duration.element(index).max(0.08)));
          vel.addAssign(vec3(0, simDt.mul(-7.5), 0));
          vel.mulAssign(float(1).sub(simDt.mul(0.8)).max(0));
          pos.addAssign(vel.mul(simDt));
          If(pos.y.lessThan(-4), () => {
            lifeN.assign(0);
          });
        });
      });
    })().compute(PARTICLE_COUNT);

    const material = new THREE.SpriteNodeMaterial();
    const lifeNode = this.life.element(instanceIndex);
    const centered = uv().sub(0.5).length();
    material.colorNode = this.colors.element(instanceIndex);
    material.positionNode = this.positions.toAttribute();
    material.scaleNode = lifeNode.mul(0.2);
    material.opacityNode = float(1).sub(smoothstep(0.22, 0.5, centered)).mul(clamp(lifeNode, 0, 1));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    this.sprite = new THREE.Sprite(material);
    this.sprite.count = PARTICLE_COUNT;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 3;
    this.sprite.name = 'mining-particles';
    scene.add(this.sprite);
  }

  reset(renderer: THREE.WebGPURenderer): void {
    this.pending = false;
    this.tokenUniform.value = -1;
    renderer.compute(this.initCompute);
  }

  setPlayer(position: THREE.Vector3): void {
    this.playerPos.value.copy(position);
  }

  setDt(dt: number): void {
    this.simDt.value = dt;
  }

  burst(x: number, y: number, z: number, color: readonly [number, number, number], count: number, speed: number, lifeSpan: number): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const magnitude = speed * (0.35 + Math.random() * 0.95);
      this.push(
        x,
        y,
        z,
        Math.sin(phi) * Math.cos(theta) * magnitude,
        Math.cos(phi) * magnitude,
        Math.sin(phi) * Math.sin(theta) * magnitude,
        color[0],
        color[1],
        color[2],
        lifeSpan * (0.65 + Math.random() * 0.7),
      );
    }
  }

  update(renderer: THREE.WebGPURenderer): void {
    this.flushSpawns();
    renderer.compute(this.updateCompute);
  }

  private push(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    lifeSpan: number,
  ): void {
    if (!this.pending) {
      this.token += 1;
      if (this.token > 1_000_000) {
        this.token = 1;
        const velocity = this.buffer(this.spawnVel);
        for (let i = 3; i < velocity.length; i += 4) velocity[i] = 0;
      }
      this.pending = true;
    }
    const index = this.cursor;
    this.cursor += 1;
    if (this.cursor >= PARTICLE_COUNT) this.cursor = AMBIENT_PARTICLES;
    const offset = index * 4;
    const positions = this.buffer(this.spawnPos);
    const velocity = this.buffer(this.spawnVel);
    const colors = this.buffer(this.spawnCol);
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    positions[offset + 3] = lifeSpan;
    velocity[offset] = vx;
    velocity[offset + 1] = vy;
    velocity[offset + 2] = vz;
    velocity[offset + 3] = this.token;
    colors[offset] = r;
    colors[offset + 1] = g;
    colors[offset + 2] = b;
    colors[offset + 3] = 1;
  }

  private flushSpawns(): void {
    this.tokenUniform.value = this.pending ? this.token : -1;
    if (!this.pending) return;
    this.spawnPos.value.needsUpdate = true;
    this.spawnVel.value.needsUpdate = true;
    this.spawnCol.value.needsUpdate = true;
    this.pending = false;
  }

  private buffer(node: StorageBufferNode<'vec4'>): Float32Array {
    return node.value.array as Float32Array;
  }
}
