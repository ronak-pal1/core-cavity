export const WORLD_X = 48;
export const WORLD_Y = 64;
export const WORLD_Z = 48;

export const PARTICLE_COUNT = 20480;
export const AMBIENT_PARTICLES = 2048;
export const MAX_LIGHTS = 12;
export const PLAYER_RADIUS = 0.32;

export enum Voxel {
  Air = 0,
  Rock = 1,
  Ore = 2,
  Energy = 3,
  Hazard = 4,
  Lava = 5,
  Core = 6,
  Bedrock = 7,
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RayHit {
  x: number;
  y: number;
  z: number;
  distance: number;
  nx: number;
  ny: number;
  nz: number;
  px: number;
  py: number;
  pz: number;
}

export interface MineEvent {
  x: number;
  y: number;
  z: number;
  type: Voxel;
}

export interface DigHit {
  x: number;
  y: number;
  z: number;
  type: Voxel;
  destroyed: boolean;
}

export interface DigResult {
  hit: DigHit | null;
  events: MineEvent[];
}

export interface Emitter {
  x: number;
  y: number;
  z: number;
  type: Voxel;
  voxelIndex: number;
}

export interface WorldGen {
  seed: number;
  start: Vec3;
  core: Vec3;
  air: number;
  emitters: number;
}
