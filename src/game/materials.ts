import {
  Fn,
  If,
  Loop,
  attribute,
  cameraPosition,
  color,
  dot,
  float,
  min,
  mix,
  mx_noise_float,
  normalWorld,
  oneMinus,
  positionWorld,
  pow,
  saturate,
  select,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import type { LightField } from './lighting';
import { MAX_LIGHTS, Voxel } from './types';

export interface CaveMaterial {
  material: THREE.MeshBasicNodeMaterial;
  danger: UniformNode<'float', number>;
}

export interface EngineMaterial {
  material: THREE.MeshBasicNodeMaterial;
  thrust: UniformNode<'float', number>;
}

function accumulateLights(field: LightField) {
  const acc = vec3(0, 0, 0).toVar();
  Loop(MAX_LIGHTS, ({ i }) => {
    const positionRadius = field.posRadius.element(i);
    const colorIntensity = field.colorIntensity.element(i);
    If(colorIntensity.w.greaterThan(0.001), () => {
      const toLight = positionRadius.xyz.sub(positionWorld).toVar();
      const dist = toLight.length().max(0.001).toVar();
      const atten = saturate(float(1).sub(dist.div(positionRadius.w.max(0.001)))).pow(1.15);
      const wrap = saturate(dot(normalWorld, toLight.div(dist))).mul(0.82).add(0.18);
      acc.addAssign(colorIntensity.xyz.mul(colorIntensity.w).mul(atten).mul(wrap));
    });
  });
  return acc;
}

export function createCaveMaterial(field: LightField): CaveMaterial {
  const danger = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial();
  material.fog = false;
  const shaded = Fn(() => {
    const voxelType = attribute('aType', 'float');
    const albedo = attribute('aColor', 'vec3');
    const diffuse = accumulateLights(field);
    const viewDir = normalizeSafe(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1).sub(saturate(dot(normalWorld, viewDir))), float(2.2));
    const coords = uv();
    const edge = min(min(coords.x, oneMinus(coords.x)), min(coords.y, oneMinus(coords.y)));
    const edgeGlow = smoothstep(float(0.16), float(0), edge);
    const strata = sin(positionWorld.y.mul(5.2)).mul(0.5).add(0.5);
    const detail = albedo.mul(float(0.86).add(strata.mul(0.18))).add(vec3(0.04, 0.07, 0.08).mul(edgeGlow));
    const painted = select(voxelType.lessThan(1.5), detail, albedo.add(vec3(0.08, 0.1, 0.12).mul(edgeGlow)));
    const pulse = sin(time.mul(2.6).add(positionWorld.y.mul(1.7))).mul(0.5).add(0.5);
    const oreGlow = vec3(0.2, 0.95, 1).mul(pulse.mul(1.1).add(0.7)).mul(2.4);
    const energyGlow = vec3(0.45, 1, 0.3).mul(sin(time.mul(7)).mul(0.25).add(1.3)).mul(2.2);
    const hazardGlow = vec3(1, 0.12, 0.5).mul(sin(time.mul(9).add(positionWorld.x)).mul(0.45).add(0.85)).mul(2.5);
    const flow = sin(positionWorld.x.mul(1.8).add(time.mul(1.5))).mul(sin(positionWorld.z.mul(1.45).sub(time.mul(1.1))));
    const lavaGlow = vec3(1.15, 0.32, 0.04).mul(flow.mul(0.35).add(1.05)).mul(2.6);
    const coreGlow = vec3(1, 0.84, 0.3).mul(sin(time.mul(3)).mul(0.2).add(1.5)).mul(3.1);
    const emissive = select(
      voxelType.greaterThan(6.5),
      vec3(0, 0, 0),
      select(
        voxelType.greaterThan(5.5),
        coreGlow,
        select(
          voxelType.greaterThan(4.5),
          lavaGlow,
          select(
            voxelType.greaterThan(3.5),
            hazardGlow,
            select(voxelType.greaterThan(2.5), energyGlow, select(voxelType.greaterThan(1.5), oreGlow, vec3(0, 0, 0))),
          ),
        ),
      ),
    );
    const ambient = mix(vec3(0.045, 0.05, 0.06), vec3(0.09, 0.035, 0.02), danger);
    const lit = painted.mul(ambient.add(min(diffuse, vec3(2.4)))).add(emissive).add(vec3(0.05, 0.16, 0.2).mul(fresnel));
    const dist = cameraPosition.distance(positionWorld);
    const fogNoise = mx_noise_float(positionWorld.mul(0.11).add(vec3(0, time.mul(0.18), 0)));
    const density = float(0.03).add(danger.mul(0.012)).mul(float(1).add(fogNoise.mul(0.45)));
    const fogFactor = saturate(float(1).sub(density.mul(dist).negate().exp()));
    const fogColor = mix(vec3(0.015, 0.025, 0.04), vec3(0.16, 0.045, 0.02), danger);
    return vec4(mix(lit, fogColor, fogFactor), 1);
  })();
  material.colorNode = shaded;
  return { material, danger };
}

export function createHullMaterial(field: LightField): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const diffuse = accumulateLights(field);
    const viewDir = normalizeSafe(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1).sub(saturate(dot(normalWorld, viewDir))), float(1.8));
    const base = vec3(0.045, 0.055, 0.07);
    const lit = base.mul(float(0.45).add(diffuse)).add(vec3(0.15, 0.75, 1).mul(fresnel).mul(0.85));
    return vec4(lit, 1);
  })();
  return material;
}

export function createGlassMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.colorNode = Fn(() => {
    const pulse = float(0.65).add(sin(time.mul(3)).mul(0.2));
    return vec4(vec3(0.25, 0.85, 1).mul(pulse), 0.72);
  })();
  return material;
}

export function createEngineMaterial(): EngineMaterial {
  const thrust = uniform(0.35);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const pulse = float(0.78).add(sin(time.mul(18)).mul(0.22));
    const glow = vec3(0.25, 0.85, 1).mul(pulse).mul(thrust.add(0.4)).mul(2.6);
    return vec4(glow, 1);
  })();
  return { material, thrust };
}

export function beamColor(hot: boolean): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  const tint = hot ? color(0.55, 0.95, 1) : color(0.2, 0.55, 1);
  material.colorNode = Fn(() => {
    const pulse = float(0.8).add(sin(time.mul(hot ? 46 : 18)).mul(0.2));
    return vec4(tint.mul(pulse).mul(hot ? 2.8 : 1.1), hot ? 0.95 : 0.28);
  })();
  return material;
}

function normalizeSafe(vector: Node<'vec3'>) {
  return vector.div(vector.length().max(0.001));
}

export const VOXEL_SPARK: Record<number, [number, number, number]> = {
  [Voxel.Rock]: [0.72, 0.55, 0.38],
  [Voxel.Ore]: [0.35, 1, 1],
  [Voxel.Energy]: [0.55, 1, 0.4],
  [Voxel.Hazard]: [1, 0.25, 0.65],
  [Voxel.Lava]: [1, 0.42, 0.08],
  [Voxel.Core]: [1, 0.9, 0.45],
  [Voxel.Bedrock]: [0.45, 0.48, 0.55],
  [Voxel.Air]: [0.7, 0.7, 0.7],
};
