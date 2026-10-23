import { makeNoise, type Noise } from './noise';
import {
  PLAYER_RADIUS,
  Voxel,
  type Emitter,
  type RayHit,
  type Vec3,
  type WorldGen,
} from './types';

export const DIRS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
] as const;

export class VoxelGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly cellCount: number;
  readonly types: Uint8Array;
  readonly hp: Uint8Array;
  readonly maxHp: Uint8Array;
  emitters: Emitter[] = [];
  private emitterSlot: Int32Array;
  seed = 1;
  spawn: Vec3 = { x: 0, y: 0, z: 0 };
  core: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.cellCount = sizeX * sizeY * sizeZ;
    this.types = new Uint8Array(this.cellCount);
    this.hp = new Uint8Array(this.cellCount);
    this.maxHp = new Uint8Array(this.cellCount);
    this.emitterSlot = new Int32Array(this.cellCount);
    this.emitterSlot.fill(-1);
  }

  index(x: number, y: number, z: number): number {
    return x + this.sizeX * (y + this.sizeY * z);
  }

  coords(index: number): Vec3 {
    const x = index % this.sizeX;
    const yz = Math.floor(index / this.sizeX);
    const y = yz % this.sizeY;
    const z = Math.floor(yz / this.sizeY);
    return { x, y, z };
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): Voxel {
    if (!this.inBounds(x, y, z)) return Voxel.Bedrock;
    return this.types[this.index(x, y, z)] as Voxel;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== Voxel.Air;
  }

  fill(type: Voxel): void {
    this.types.fill(type);
    for (let y = 0; y < this.sizeY; y++) {
      const max = this.computeMax(type, y);
      for (let z = 0; z < this.sizeZ; z++) {
        for (let x = 0; x < this.sizeX; x++) {
          const i = this.index(x, y, z);
          this.maxHp[i] = max;
          this.hp[i] = type === Voxel.Air ? 0 : max;
        }
      }
    }
    this.rebuildEmitters();
  }

  set(x: number, y: number, z: number, type: Voxel): void {
    this.write(x, y, z, type, true);
  }

  generate(seed: number): WorldGen {
    this.seed = seed | 0;
    const noise = makeNoise(this.seed);
    const { sizeX: w, sizeY: h, sizeZ: d } = this;
    const cx = Math.floor(w / 2);
    const cz = Math.floor(d / 2);

    for (let z = 0; z < d; z++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const border = x < 2 || z < 2 || x >= w - 2 || z >= d - 2 || y < 1 || y >= h - 1;
          this.write(x, y, z, border ? Voxel.Bedrock : Voxel.Rock, true);
        }
      }
    }

    for (let z = 2; z < d - 2; z++) {
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          if (isCave(noise, x, y, z, h)) this.write(x, y, z, Voxel.Air, true);
        }
      }
    }

    const safe = new Uint8Array(this.cellCount);
    const carve = (x: number, y: number, z: number, radius: number) => {
      this.clearSphere(x, y, z, radius, safe, radius + 1.35);
    };

    const top = h - 9;
    const tunnel: Vec3[] = [];
    for (let y = top - 1; y >= 8; y -= 0.72) {
      const along = top - y;
      const ang = along * 0.42;
      const rad = 6.5 + Math.sin(y * 0.23) * 3.2;
      const x = cx + Math.cos(ang) * rad;
      const z = cz + Math.sin(ang) * rad;
      carve(x, y, z, 3.15);
      tunnel.push({ x, y, z });
    }

    carve(cx, top, cz, 5.7);
    carve(cx, 7.2, cz, 5.9);
    carve(cx, 8.5, cz, 3.5);

    for (let i = 0; i < tunnel.length; i += 6) {
      const p = tunnel[i];
      if (!p) continue;
      const ang = i * 1.7;
      carve(p.x + Math.cos(ang) * 5.2, p.y - 0.4, p.z + Math.sin(ang) * 5.2, 2.2 + (i % 5) * 0.18);
    }

    for (let dy = 0; dy <= 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          this.write(cx + dx, 4 + dy, cz + dz, Voxel.Core, false);
        }
      }
    }

    this.sprinkle(noise, safe);

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      this.placeNear(cx + Math.cos(ang) * 6.2, top, cz + Math.sin(ang) * 6.2, i % 3 === 0 ? Voxel.Energy : Voxel.Ore);
    }
    for (let i = 0; i < tunnel.length; i += 4) {
      const p = tunnel[i];
      if (!p) continue;
      this.placeNear(p.x, p.y, p.z, i % 8 === 0 ? Voxel.Ore : Voxel.Energy);
    }

    const pocket = this.findPocket(cx, top, cz);
    this.spawn = pocket;
    this.core = { x: cx + 0.5, y: 5, z: cz + 0.5 };
    this.rebuildEmitters();

    let air = 0;
    for (let i = 0; i < this.cellCount; i++) if (this.types[i] === Voxel.Air) air++;
    return {
      seed: this.seed,
      start: this.spawn,
      core: this.core,
      air,
      emitters: this.emitters.length,
    };
  }

  clearSphere(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    safe: Uint8Array | null = null,
    markRadius = radius,
  ): void {
    const r2 = radius * radius;
    const m2 = markRadius * markRadius;
    const reach = Math.max(radius, markRadius);
    const minX = Math.max(0, Math.floor(cx - reach));
    const maxX = Math.min(this.sizeX - 1, Math.floor(cx + reach));
    const minY = Math.max(0, Math.floor(cy - reach));
    const maxY = Math.min(this.sizeY - 1, Math.floor(cy + reach));
    const minZ = Math.max(0, Math.floor(cz - reach));
    const maxZ = Math.min(this.sizeZ - 1, Math.floor(cz + reach));
    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const dz = z + 0.5 - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const i = this.index(x, y, z);
          if (safe && d2 <= m2) safe[i] = 1;
          if (d2 <= r2 && this.types[i] !== Voxel.Bedrock) this.write(x, y, z, Voxel.Air, true);
        }
      }
    }
  }

  applyDamage(x: number, y: number, z: number, amount: number): { type: Voxel; destroyed: boolean } | null {
    if (!this.inBounds(x, y, z) || amount <= 0) return null;
    const i = this.index(x, y, z);
    const type = this.types[i] as Voxel;
    if (type === Voxel.Air || type === Voxel.Bedrock) return null;
    const next = this.hp[i] - amount;
    if (next > 0) {
      this.hp[i] = next;
      return { type, destroyed: false };
    }
    this.types[i] = Voxel.Air;
    this.hp[i] = 0;
    this.maxHp[i] = 0;
    this.removeEmitter(i);
    return { type, destroyed: true };
  }

  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    out: RayHit,
  ): boolean {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-8 || maxDist <= 0) return false;
    dx /= len;
    dy /= len;
    dz /= len;
    ox += dx * 1e-4;
    oy += dy * 1e-4;
    oz += dz * 1e-4;

    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = nextBoundary(ox, stepX, tDeltaX);
    let tMaxY = nextBoundary(oy, stepY, tDeltaY);
    let tMaxZ = nextBoundary(oz, stepZ, tDeltaZ);

    if (this.isSolid(x, y, z)) {
      this.writeHit(out, x, y, z, 0, 0, 0, 0, ox, oy, oz);
      return true;
    }

    let traveled = 0;
    const maxSteps = Math.ceil(maxDist * 3) + 8;
    for (let step = 0; step < maxSteps; step++) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        x += stepX;
        traveled = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX;
      } else if (tMaxY <= tMaxZ) {
        y += stepY;
        traveled = tMaxY;
        tMaxY += tDeltaY;
        ny = -stepY;
      } else {
        z += stepZ;
        traveled = tMaxZ;
        tMaxZ += tDeltaZ;
        nz = -stepZ;
      }
      if (traveled > maxDist) return false;
      if (!this.inBounds(x, y, z)) return false;
      if (this.isSolid(x, y, z)) {
        this.writeHit(out, x, y, z, traveled, nx, ny, nz, ox + dx * traveled, oy + dy * traveled, oz + dz * traveled);
        return true;
      }
    }
    return false;
  }

  resolveSphere(pos: Vec3, radius = PLAYER_RADIUS): boolean {
    let lava = false;
    const minPad = radius;
    for (let iter = 0; iter < 4; iter++) {
      const minX = Math.floor(pos.x - minPad);
      const maxX = Math.floor(pos.x + minPad);
      const minY = Math.floor(pos.y - minPad);
      const maxY = Math.floor(pos.y + minPad);
      const minZ = Math.floor(pos.z - minPad);
      const maxZ = Math.floor(pos.z + minPad);
      let pushed = false;
      for (let z = minZ; z <= maxZ; z++) {
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (!this.isSolid(x, y, z)) continue;
            if (this.get(x, y, z) === Voxel.Lava) lava = true;
            const nearestX = clamp(pos.x, x, x + 1);
            const nearestY = clamp(pos.y, y, y + 1);
            const nearestZ = clamp(pos.z, z, z + 1);
            let dx = pos.x - nearestX;
            let dy = pos.y - nearestY;
            let dz = pos.z - nearestZ;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= radius * radius) continue;
            if (d2 > 1e-8) {
              const dist = Math.sqrt(d2);
              const pen = radius - dist;
              pos.x += (dx / dist) * pen;
              pos.y += (dy / dist) * pen;
              pos.z += (dz / dist) * pen;
              pushed = true;
              continue;
            }
            const left = pos.x - x;
            const right = x + 1 - pos.x;
            const down = pos.y - y;
            const up = y + 1 - pos.y;
            const back = pos.z - z;
            const front = z + 1 - pos.z;
            let face = left;
            let ax = -1;
            let ay = 0;
            let az = 0;
            if (right < face) {
              face = right;
              ax = 1;
              ay = 0;
              az = 0;
            }
            if (down < face) {
              face = down;
              ax = 0;
              ay = -1;
              az = 0;
            }
            if (up < face) {
              face = up;
              ax = 0;
              ay = 1;
              az = 0;
            }
            if (back < face) {
              face = back;
              ax = 0;
              ay = 0;
              az = -1;
            }
            if (front < face) {
              face = front;
              ax = 0;
              ay = 0;
              az = 1;
            }
            pos.x += ax * (face + radius + 1e-3);
            pos.y += ay * (face + radius + 1e-3);
            pos.z += az * (face + radius + 1e-3);
            pushed = true;
          }
        }
      }
      if (!pushed) break;
    }
    pos.x = clamp(pos.x, 1.2, this.sizeX - 1.2);
    pos.y = clamp(pos.y, 1.2, this.sizeY - 1.2);
    pos.z = clamp(pos.z, 1.2, this.sizeZ - 1.2);
    return lava;
  }

  private writeHit(
    out: RayHit,
    x: number,
    y: number,
    z: number,
    distance: number,
    nx: number,
    ny: number,
    nz: number,
    px: number,
    py: number,
    pz: number,
  ): void {
    out.x = x;
    out.y = y;
    out.z = z;
    out.distance = distance;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.px = px;
    out.py = py;
    out.pz = pz;
  }

  private sprinkle(noise: Noise, safe: Uint8Array): void {
    const { sizeX: w, sizeY: h, sizeZ: d } = this;
    for (let z = 2; z < d - 2; z++) {
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const i = this.index(x, y, z);
          if (this.types[i] !== Voxel.Rock) continue;
          if (!this.hasAirNeighbor(x, y, z)) continue;
          const depth = 1 - y / (h - 1);
          const roll = noise.hash3(x * 13 + 3, y * 7 + 11, z * 17 + 5);
          const protectedWall = safe[i] === 1;
          if (protectedWall) {
            if (roll < 0.018 + depth * 0.02) this.write(x, y, z, Voxel.Energy, false);
            else if (roll < 0.09 + depth * 0.12) this.write(x, y, z, Voxel.Ore, false);
            continue;
          }
          if (depth > 0.68 && roll < 0.02 + (depth - 0.68) * 0.16) this.write(x, y, z, Voxel.Lava, false);
          else if (roll < 0.012 + depth * 0.01) this.write(x, y, z, Voxel.Energy, false);
          else if (roll < 0.03 + depth * 0.09) this.write(x, y, z, Voxel.Hazard, false);
          else if (roll < 0.1 + depth * 0.16) this.write(x, y, z, Voxel.Ore, false);
        }
      }
    }
  }

  private placeNear(x: number, y: number, z: number, type: Voxel): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iz = Math.round(z);
    for (let radius = 1; radius <= 6; radius++) {
      for (const dir of DIRS) {
        const nx = ix + dir.x * radius;
        const ny = iy + dir.y * radius;
        const nz = iz + dir.z * radius;
        if (!this.inBounds(nx, ny, nz)) continue;
        if (this.types[this.index(nx, ny, nz)] === Voxel.Rock) {
          this.write(nx, ny, nz, type, false);
          return;
        }
      }
    }
  }

  private findPocket(x: number, y: number, z: number): Vec3 {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (this.isPocket(ix, iy, iz)) return { x: ix + 0.5, y: iy + 0.5, z: iz + 0.5 };
    for (let radius = 1; radius <= 8; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
            const nx = ix + dx;
            const ny = iy + dy;
            const nz = iz + dz;
            if (this.isPocket(nx, ny, nz)) return { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5 };
          }
        }
      }
    }
    return { x: ix + 0.5, y: iy + 0.5, z: iz + 0.5 };
  }

  private isPocket(x: number, y: number, z: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!this.inBounds(x + dx, y + dy, z + dz)) return false;
          if (this.types[this.index(x + dx, y + dy, z + dz)] !== Voxel.Air) return false;
        }
      }
    }
    return true;
  }

  private hasAirNeighbor(x: number, y: number, z: number): boolean {
    for (const dir of DIRS) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      const nz = z + dir.z;
      if (!this.inBounds(nx, ny, nz)) continue;
      if (this.types[this.index(nx, ny, nz)] === Voxel.Air) return true;
    }
    return false;
  }

  private write(x: number, y: number, z: number, type: Voxel, force: boolean): void {
    if (!this.inBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    if (!force && this.types[i] === Voxel.Bedrock && type !== Voxel.Bedrock) return;
    this.types[i] = type;
    const max = this.computeMax(type, y);
    this.maxHp[i] = max;
    this.hp[i] = type === Voxel.Air ? 0 : max;
  }

  private computeMax(type: Voxel, y: number): number {
    switch (type) {
      case Voxel.Air:
        return 0;
      case Voxel.Rock: {
        const depth = 1 - y / Math.max(1, this.sizeY - 1);
        return 11 + Math.floor(depth * 8);
      }
      case Voxel.Ore:
        return 6;
      case Voxel.Energy:
        return 3;
      case Voxel.Hazard:
        return 4;
      case Voxel.Lava:
        return 16;
      case Voxel.Core:
        return 30;
      case Voxel.Bedrock:
        return 255;
      default:
        return 8;
    }
  }

  private rebuildEmitters(): void {
    const list: Emitter[] = [];
    this.emitterSlot.fill(-1);
    for (let i = 0; i < this.cellCount; i++) {
      const type = this.types[i] as Voxel;
      if (
        type !== Voxel.Ore &&
        type !== Voxel.Energy &&
        type !== Voxel.Hazard &&
        type !== Voxel.Lava &&
        type !== Voxel.Core
      ) {
        continue;
      }
      const c = this.coords(i);
      this.emitterSlot[i] = list.length;
      list.push({ x: c.x, y: c.y, z: c.z, type, voxelIndex: i });
    }
    this.emitters = list;
  }

  private removeEmitter(voxelIndex: number): void {
    const slot = this.emitterSlot[voxelIndex];
    if (slot === undefined || slot < 0) return;
    const last = this.emitters.length - 1;
    if (slot !== last) {
      const moved = this.emitters[last];
      if (moved) {
        this.emitters[slot] = moved;
        this.emitterSlot[moved.voxelIndex] = slot;
      }
    }
    this.emitters.pop();
    this.emitterSlot[voxelIndex] = -1;
  }
}

function isCave(noise: Noise, x: number, y: number, z: number, height: number): boolean {
  const depth = 1 - y / (height - 1);
  const n = noise.fbm(x * 0.11, y * 0.14, z * 0.11);
  const bands = noise.fbm(x * 0.07 + 30, y * 0.05, z * 0.07 + 8);
  const open = 0.66 - depth * 0.04;
  return n > open && bands > 0.46;
}

function nextBoundary(origin: number, step: number, tDelta: number): number {
  if (step === 0) return Infinity;
  const frac = origin - Math.floor(origin);
  if (step > 0) return (frac === 0 ? 1 : 1 - frac) * tDelta;
  return (frac === 0 ? 1 : frac) * tDelta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
