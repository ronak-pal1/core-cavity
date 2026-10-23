import * as THREE from 'three/webgpu';
import { DIRS, VoxelGrid } from './voxelGrid';
import { Voxel, WORLD_X, WORLD_Y, WORLD_Z, type DigResult, type MineEvent, type RayHit } from './types';

const INITIAL_HEADROOM = 1536;

interface FaceBucket {
  dir: number;
  capacity: number;
  count: number;
  mesh: THREE.InstancedMesh;
  instanceVoxel: Int32Array;
  matrixDirty: boolean;
  colorDirty: boolean;
  typeDirty: boolean;
}

export class Terrain {
  readonly grid: VoxelGrid;
  readonly spawn = new THREE.Vector3();
  readonly core = new THREE.Vector3();
  seed = 1;
  faceCount = 0;
  private readonly buckets: FaceBucket[] = [];
  private faceMap: Int32Array;
  private readonly events: MineEvent[] = [];
  private readonly chain: { x: number; y: number; z: number }[] = [];
  private readonly detonated = new Set<number>();
  private readonly ray = emptyRay();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly material: THREE.Material,
  ) {
    this.grid = new VoxelGrid(WORLD_X, WORLD_Y, WORLD_Z);
    this.faceMap = new Int32Array(this.grid.cellCount * 6);
    this.faceMap.fill(-1);
  }

  generate(seed: number): void {
    this.disposeMeshes();
    const world = this.grid.generate(seed);
    this.seed = world.seed;
    this.spawn.set(world.start.x, world.start.y, world.start.z);
    this.core.set(world.core.x, world.core.y, world.core.z);
    this.faceMap = new Int32Array(this.grid.cellCount * 6);
    this.faceMap.fill(-1);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let z = 0; z < WORLD_Z; z++) {
      for (let y = 0; y < WORLD_Y; y++) {
        for (let x = 0; x < WORLD_X; x++) {
          if (!this.grid.isSolid(x, y, z)) continue;
          for (let dir = 0; dir < 6; dir++) {
            const step = DIRS[dir];
            if (!step) continue;
            if (this.isOpen(x + step.x, y + step.y, z + step.z)) counts[dir] = (counts[dir] ?? 0) + 1;
          }
        }
      }
    }
    for (let dir = 0; dir < 6; dir++) {
      const needed = (counts[dir] ?? 0) + INITIAL_HEADROOM;
      this.buckets[dir] = this.createBucket(dir, Math.max(2048, needed));
    }
    for (let z = 0; z < WORLD_Z; z++) {
      for (let y = 0; y < WORLD_Y; y++) {
        for (let x = 0; x < WORLD_X; x++) {
          if (!this.grid.isSolid(x, y, z)) continue;
          for (let dir = 0; dir < 6; dir++) {
            const step = DIRS[dir];
            if (!step) continue;
            if (this.isOpen(x + step.x, y + step.y, z + step.z)) this.addFace(x, y, z, dir);
          }
        }
      }
    }
    this.flush();
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): RayHit | null {
    const hit = this.grid.raycast(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, maxDistance, this.ray);
    if (!hit) return null;
    return { ...this.ray };
  }

  damageAt(x: number, y: number, z: number, amount: number, splashDamage: number): DigResult {
    this.beginEdit();
    const hit = this.damageCell(x, y, z, amount);
    if (hit?.destroyed && splashDamage > 0) {
      for (const dir of DIRS) this.damageCell(x + dir.x, y + dir.y, z + dir.z, splashDamage);
    }
    this.flushChains();
    return { hit, events: this.events.slice() };
  }

  carveSphere(cx: number, cy: number, cz: number, radius: number): DigResult {
    this.beginEdit();
    this.destroyInRadius(cx, cy, cz, radius);
    this.flushChains();
    return { hit: null, events: this.events.slice() };
  }

  flush(): void {
    this.faceCount = 0;
    for (const bucket of this.buckets) {
      if (!bucket) continue;
      this.faceCount += bucket.count;
      bucket.mesh.count = bucket.count;
      bucket.mesh.visible = bucket.count > 0;
      if (bucket.matrixDirty) {
        bucket.mesh.instanceMatrix.needsUpdate = true;
        bucket.matrixDirty = false;
      }
      if (bucket.colorDirty) {
        bucket.mesh.geometry.getAttribute('aColor').needsUpdate = true;
        bucket.colorDirty = false;
      }
      if (bucket.typeDirty) {
        bucket.mesh.geometry.getAttribute('aType').needsUpdate = true;
        bucket.typeDirty = false;
      }
    }
  }

  private beginEdit(): void {
    this.events.length = 0;
    this.chain.length = 0;
    this.detonated.clear();
  }

  private flushChains(): void {
    let guard = 0;
    while (this.chain.length > 0 && guard < 24 && this.events.length < 900) {
      const hazard = this.chain.shift();
      if (!hazard) break;
      guard += 1;
      this.destroyInRadius(hazard.x + 0.5, hazard.y + 0.5, hazard.z + 0.5, 2.35);
    }
  }

  private destroyInRadius(cx: number, cy: number, cz: number, radius: number): void {
    const radius2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(WORLD_X - 1, Math.floor(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(WORLD_Y - 1, Math.floor(cy + radius));
    const minZ = Math.max(0, Math.floor(cz - radius));
    const maxZ = Math.min(WORLD_Z - 1, Math.floor(cz + radius));
    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > radius2) continue;
          this.damageCell(x, y, z, 1000);
        }
      }
    }
  }

  private damageCell(x: number, y: number, z: number, amount: number) {
    const result = this.grid.applyDamage(x, y, z, amount);
    if (!result) return null;
    if (!result.destroyed) {
      this.recolor(x, y, z);
      return { x, y, z, type: result.type, destroyed: false };
    }
    this.onDestroyed(x, y, z);
    if (result.type === Voxel.Hazard) {
      const index = this.grid.index(x, y, z);
      if (!this.detonated.has(index)) {
        this.detonated.add(index);
        this.chain.push({ x, y, z });
      }
    }
    this.events.push({ x, y, z, type: result.type });
    return { x, y, z, type: result.type, destroyed: true };
  }

  private onDestroyed(x: number, y: number, z: number): void {
    const voxelIndex = this.grid.index(x, y, z);
    for (let dir = 0; dir < 6; dir++) this.removeFace(voxelIndex, dir);
    for (let dir = 0; dir < 6; dir++) {
      const step = DIRS[dir];
      if (!step) continue;
      const nx = x + step.x;
      const ny = y + step.y;
      const nz = z + step.z;
      if (this.grid.isSolid(nx, ny, nz)) this.addFace(nx, ny, nz, dir ^ 1);
    }
  }

  private recolor(x: number, y: number, z: number): void {
    const voxelIndex = this.grid.index(x, y, z);
    const type = this.grid.types[voxelIndex] as Voxel;
    const max = this.grid.maxHp[voxelIndex] ?? 1;
    const hp = this.grid.hp[voxelIndex] ?? 0;
    const ratio = max > 0 ? hp / max : 1;
    const tint = shadeVoxel(type, x, y, z, ratio);
    for (let dir = 0; dir < 6; dir++) {
      const instance = this.faceMap[voxelIndex * 6 + dir] ?? -1;
      if (instance < 0) continue;
      const bucket = this.buckets[dir];
      if (!bucket) continue;
      writeColor(bucket, instance, tint);
      bucket.colorDirty = true;
    }
  }

  private addFace(x: number, y: number, z: number, dir: number): void {
    if (!this.grid.isSolid(x, y, z)) return;
    const voxelIndex = this.grid.index(x, y, z);
    const faceId = voxelIndex * 6 + dir;
    if ((this.faceMap[faceId] ?? -1) >= 0) return;
    let bucket = this.buckets[dir];
    if (!bucket) return;
    if (bucket.count >= bucket.capacity) bucket = this.grow(bucket, bucket.capacity * 2);
    const instance = bucket.count;
    bucket.count += 1;
    bucket.mesh.count = bucket.count;
    this.faceMap[faceId] = instance;
    bucket.instanceVoxel[instance] = voxelIndex;
    const step = DIRS[dir];
    if (!step) return;
    const px = x + 0.5 + step.x * 0.5;
    const py = y + 0.5 + step.y * 0.5;
    const pz = z + 0.5 + step.z * 0.5;
    writeMatrix(bucket, instance, px, py, pz);
    const type = this.grid.types[voxelIndex] as Voxel;
    const max = this.grid.maxHp[voxelIndex] ?? 1;
    const hp = this.grid.hp[voxelIndex] ?? max;
    writeColor(bucket, instance, shadeVoxel(type, x, y, z, max > 0 ? hp / max : 1));
    writeType(bucket, instance, type);
    bucket.matrixDirty = true;
    bucket.colorDirty = true;
    bucket.typeDirty = true;
  }

  private removeFace(voxelIndex: number, dir: number): void {
    const faceId = voxelIndex * 6 + dir;
    const instance = this.faceMap[faceId] ?? -1;
    if (instance < 0) return;
    const bucket = this.buckets[dir];
    if (!bucket) return;
    const last = bucket.count - 1;
    if (instance !== last) {
      copyInstance(bucket, last, instance);
      const movedVoxel = bucket.instanceVoxel[last] ?? -1;
      if (movedVoxel >= 0) this.faceMap[movedVoxel * 6 + dir] = instance;
      bucket.instanceVoxel[instance] = movedVoxel;
    }
    this.faceMap[faceId] = -1;
    bucket.instanceVoxel[last] = -1;
    bucket.count = last;
    bucket.mesh.count = last;
    bucket.matrixDirty = true;
    bucket.colorDirty = true;
    bucket.typeDirty = true;
  }

  private isOpen(x: number, y: number, z: number): boolean {
    return this.grid.inBounds(x, y, z) && !this.grid.isSolid(x, y, z);
  }

  private createBucket(dir: number, capacity: number): FaceBucket {
    const geometry = createFaceGeometry(dir);
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('aType', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.raycast = () => undefined;
    mesh.name = `cave-face-${dir}`;
    this.scene.add(mesh);
    return {
      dir,
      capacity,
      count: 0,
      mesh,
      instanceVoxel: new Int32Array(capacity).fill(-1),
      matrixDirty: false,
      colorDirty: false,
      typeDirty: false,
    };
  }

  private grow(bucket: FaceBucket, capacity: number): FaceBucket {
    const next = this.createBucket(bucket.dir, capacity);
    const copyCount = bucket.count;
    (next.mesh.instanceMatrix.array as Float32Array).set((bucket.mesh.instanceMatrix.array as Float32Array).subarray(0, copyCount * 16));
    colorArray(next).set(colorArray(bucket).subarray(0, copyCount * 3));
    typeArray(next).set(typeArray(bucket).subarray(0, copyCount));
    next.instanceVoxel.set(bucket.instanceVoxel.subarray(0, copyCount));
    next.count = copyCount;
    next.mesh.count = copyCount;
    next.matrixDirty = true;
    next.colorDirty = true;
    next.typeDirty = true;
    this.scene.remove(bucket.mesh);
    bucket.mesh.geometry.dispose();
    this.buckets[bucket.dir] = next;
    return next;
  }

  private disposeMeshes(): void {
    for (const bucket of this.buckets) {
      if (!bucket) continue;
      this.scene.remove(bucket.mesh);
      bucket.mesh.geometry.dispose();
    }
    this.buckets.length = 0;
  }
}

function createFaceGeometry(dir: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1);
  if (dir === 0) geometry.rotateY(Math.PI / 2);
  else if (dir === 1) geometry.rotateY(-Math.PI / 2);
  else if (dir === 2) geometry.rotateX(-Math.PI / 2);
  else if (dir === 3) geometry.rotateX(Math.PI / 2);
  else if (dir === 5) geometry.rotateY(Math.PI);
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(WORLD_X / 2, WORLD_Y / 2, WORLD_Z / 2),
    Math.hypot(WORLD_X, WORLD_Y, WORLD_Z),
  );
  return geometry;
}

function writeMatrix(bucket: FaceBucket, instance: number, x: number, y: number, z: number): void {
  const array = bucket.mesh.instanceMatrix.array as Float32Array;
  const offset = instance * 16;
  array[offset] = 1;
  array[offset + 1] = 0;
  array[offset + 2] = 0;
  array[offset + 3] = 0;
  array[offset + 4] = 0;
  array[offset + 5] = 1;
  array[offset + 6] = 0;
  array[offset + 7] = 0;
  array[offset + 8] = 0;
  array[offset + 9] = 0;
  array[offset + 10] = 1;
  array[offset + 11] = 0;
  array[offset + 12] = x;
  array[offset + 13] = y;
  array[offset + 14] = z;
  array[offset + 15] = 1;
}

function copyInstance(bucket: FaceBucket, from: number, to: number): void {
  const matrices = bucket.mesh.instanceMatrix.array as Float32Array;
  matrices.copyWithin(to * 16, from * 16, from * 16 + 16);
  const colors = colorArray(bucket);
  colors.copyWithin(to * 3, from * 3, from * 3 + 3);
  const types = typeArray(bucket);
  const typeValue = types[from] ?? 0;
  types[to] = typeValue;
}

function writeColor(bucket: FaceBucket, instance: number, tint: [number, number, number]): void {
  const colors = colorArray(bucket);
  const offset = instance * 3;
  colors[offset] = tint[0];
  colors[offset + 1] = tint[1];
  colors[offset + 2] = tint[2];
}

function writeType(bucket: FaceBucket, instance: number, type: Voxel): void {
  typeArray(bucket)[instance] = type;
}

function colorArray(bucket: FaceBucket): Float32Array {
  return bucket.mesh.geometry.getAttribute('aColor').array as Float32Array;
}

function typeArray(bucket: FaceBucket): Float32Array {
  return bucket.mesh.geometry.getAttribute('aType').array as Float32Array;
}

function shadeVoxel(type: Voxel, x: number, y: number, z: number, ratio: number): [number, number, number] {
  const variation = 0.78 + hashCoord(x, y, z) * 0.34;
  const depth = 1 - y / (WORLD_Y - 1);
  const crack = 0.42 + 0.58 * Math.max(0, Math.min(1, ratio));
  switch (type) {
    case Voxel.Rock:
      return [(0.26 + depth * 0.22) * variation * crack, (0.24 - depth * 0.05) * variation * crack, (0.22 - depth * 0.07) * variation * crack];
    case Voxel.Bedrock:
      return [0.09 * variation, 0.09 * variation, 0.11 * variation];
    case Voxel.Ore:
      return [0.16, 0.7 + variation * 0.2, 0.98];
    case Voxel.Energy:
      return [0.42, 0.98, 0.34];
    case Voxel.Hazard:
      return [0.98, 0.12 + variation * 0.08, 0.58];
    case Voxel.Lava:
      return [1, 0.3 + variation * 0.16, 0.05];
    case Voxel.Core:
      return [1, 0.84, 0.28 + variation * 0.16];
    default:
      return [0.2, 0.2, 0.2];
  }
}

function hashCoord(x: number, y: number, z: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function emptyRay(): RayHit {
  return { x: 0, y: 0, z: 0, distance: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 };
}
