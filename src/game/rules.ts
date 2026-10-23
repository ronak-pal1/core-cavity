import { Voxel } from './types';

export interface LaserProfile {
  tier: number;
  range: number;
  damagePerSecond: number;
  fuelPerSecond: number;
  splashDamage: number;
}

export interface ChargeProfile {
  tier: number;
  range: number;
  radius: number;
  cooldown: number;
  fuelCost: number;
}

export function clampTier(tier: number): number {
  return Math.min(6, Math.max(1, Math.round(tier)));
}

export function depthMeters(startY: number, y: number): number {
  return Math.max(0, startY - y);
}

export function scoreMultiplier(depth: number): number {
  return 1 + depth / 16;
}

export function hazardLabel(depth: number): string {
  if (depth < 10) return 'STABLE';
  if (depth < 22) return 'FRACTURED';
  if (depth < 36) return 'VOLATILE';
  return 'CRITICAL';
}

export function laserProfile(tier: number): LaserProfile {
  const t = clampTier(tier);
  return {
    tier: t,
    range: 13 + t * 1.7,
    damagePerSecond: 9 + t * 2.6,
    fuelPerSecond: 4.6 + t * 0.35,
    splashDamage: t >= 4 ? 7 + t * 1.4 : 0,
  };
}

export function chargeProfile(tier: number): ChargeProfile {
  const t = clampTier(tier);
  return {
    tier: t,
    range: 18 + t * 1.2,
    radius: 3.45 + t * 0.26,
    cooldown: Math.max(1.05, 2.75 - t * 0.22),
    fuelCost: 18,
  };
}

export function pointsFor(type: Voxel, multiplier: number): number {
  switch (type) {
    case Voxel.Ore:
      return Math.round(120 * multiplier);
    case Voxel.Energy:
      return Math.round(30 * multiplier);
    case Voxel.Hazard:
      return Math.round(55 * multiplier);
    case Voxel.Lava:
      return Math.round(8 * multiplier);
    case Voxel.Core:
      return Math.round(12000 * multiplier);
    case Voxel.Rock:
      return Math.round(2 * multiplier);
    default:
      return 0;
  }
}

export function tierFromOre(startTier: number, ore: number): number {
  return Math.min(6, clampTier(startTier) + Math.floor(ore / 8));
}
