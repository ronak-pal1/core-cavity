import { attributeArray } from 'three/tsl';
import type { StorageBufferNode } from 'three/webgpu';
import { Voxel, MAX_LIGHTS, type Emitter } from './types';

export interface LightSample {
  x: number;
  y: number;
  z: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export class LightField {
  readonly posRadius: StorageBufferNode<'vec4'>;
  readonly colorIntensity: StorageBufferNode<'vec4'>;

  constructor() {
    this.posRadius = attributeArray(MAX_LIGHTS, 'vec4').toReadOnly();
    this.colorIntensity = attributeArray(MAX_LIGHTS, 'vec4').toReadOnly();
    this.clear();
  }

  clear(): void {
    this.positions().fill(0);
    this.colors().fill(0);
    for (let i = 0; i < MAX_LIGHTS; i++) this.positions()[i * 4 + 3] = 0.001;
  }

  set(index: number, light: LightSample): void {
    if (index < 0 || index >= MAX_LIGHTS) return;
    const offset = index * 4;
    const positions = this.positions();
    const colors = this.colors();
    positions[offset] = light.x;
    positions[offset + 1] = light.y;
    positions[offset + 2] = light.z;
    positions[offset + 3] = Math.max(0.001, light.radius);
    colors[offset] = light.r;
    colors[offset + 1] = light.g;
    colors[offset + 2] = light.b;
    colors[offset + 3] = light.intensity;
  }

  upload(): void {
    this.posRadius.value.needsUpdate = true;
    this.colorIntensity.value.needsUpdate = true;
  }

  private positions(): Float32Array {
    return this.posRadius.value.array as Float32Array;
  }

  private colors(): Float32Array {
    return this.colorIntensity.value.array as Float32Array;
  }
}

export function emitterLight(emitter: Emitter): LightSample {
  const x = emitter.x + 0.5;
  const y = emitter.y + 0.5;
  const z = emitter.z + 0.5;
  switch (emitter.type) {
    case Voxel.Ore:
      return { x, y, z, radius: 4.2, r: 0.25, g: 0.9, b: 1, intensity: 1.6 };
    case Voxel.Energy:
      return { x, y, z, radius: 3.6, r: 0.5, g: 1, b: 0.35, intensity: 1.45 };
    case Voxel.Hazard:
      return { x, y, z, radius: 3.4, r: 1, g: 0.16, b: 0.55, intensity: 1.35 };
    case Voxel.Lava:
      return { x, y, z, radius: 4.4, r: 1, g: 0.38, b: 0.06, intensity: 1.7 };
    case Voxel.Core:
      return { x, y, z, radius: 8.5, r: 1, g: 0.82, b: 0.32, intensity: 2.8 };
    default:
      return { x, y, z, radius: 0.001, r: 0, g: 0, b: 0, intensity: 0 };
  }
}

export function packLights(field: LightField, lights: LightSample[]): void {
  field.clear();
  const count = Math.min(MAX_LIGHTS, lights.length);
  for (let i = 0; i < count; i++) {
    const light = lights[i];
    if (light) field.set(i, light);
  }
  field.upload();
}

export function nearestEmitters(emitters: readonly Emitter[], x: number, y: number, z: number, limit: number, range: number): Emitter[] {
  const range2 = range * range;
  const picks: { distance: number; emitter: Emitter }[] = [];
  for (let i = 0; i < emitters.length; i++) {
    const emitter = emitters[i];
    if (!emitter) continue;
    const dx = emitter.x + 0.5 - x;
    const dy = emitter.y + 0.5 - y;
    const dz = emitter.z + 0.5 - z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance > range2) continue;
    if (picks.length < limit) {
      picks.push({ distance, emitter });
      if (picks.length === limit) picks.sort((a, b) => a.distance - b.distance);
      continue;
    }
    const last = picks[limit - 1];
    if (last && distance < last.distance) {
      picks[limit - 1] = { distance, emitter };
      picks.sort((a, b) => a.distance - b.distance);
    }
  }
  if (picks.length < limit) picks.sort((a, b) => a.distance - b.distance);
  return picks.map((pick) => pick.emitter);
}
