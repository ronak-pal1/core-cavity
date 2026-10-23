import { VoxelGrid, DIRS } from './voxelGrid';
import { chargeProfile, depthMeters, laserProfile, scoreMultiplier, tierFromOre } from './rules';
import { Voxel, type RayHit, WORLD_X, WORLD_Y, WORLD_Z } from './types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function emptyHit(): RayHit {
  return { x: 0, y: 0, z: 0, distance: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 };
}

function testRaycast(): void {
  const grid = new VoxelGrid(8, 8, 8);
  grid.fill(Voxel.Air);
  grid.set(4, 3, 3, Voxel.Rock);
  const hit = emptyHit();
  const found = grid.raycast(0.5, 3.5, 3.5, 1, 0, 0, 10, hit);
  assert(found, 'ray should hit the rock slab');
  assert(hit.x === 4 && hit.y === 3 && hit.z === 3, `unexpected hit ${hit.x},${hit.y},${hit.z}`);
  assert(hit.nx === -1, 'hit normal should face the ray');

  const miss = grid.raycast(0.5, 1.5, 1.5, 1, 0, 0, 6, hit);
  assert(!miss, 'clear ray should miss');

  grid.set(1, 1, 1, Voxel.Rock);
  const inside = grid.raycast(1.2, 1.2, 1.2, 0, 1, 0, 4, hit);
  assert(inside && hit.x === 1, 'ray starting inside a solid returns that voxel');
}

function testDamageAndBedrock(): void {
  const grid = new VoxelGrid(6, 6, 6);
  grid.fill(Voxel.Air);
  grid.set(2, 2, 2, Voxel.Rock);
  const chip = grid.applyDamage(2, 2, 2, 3);
  assert(chip !== null && !chip.destroyed, 'partial damage keeps the voxel');
  assert(grid.get(2, 2, 2) === Voxel.Rock, 'chipped voxel stays rock');
  const rest = grid.maxHp[grid.index(2, 2, 2)] ?? 0;
  const broken = grid.applyDamage(2, 2, 2, rest);
  assert(broken?.destroyed === true, 'hp depletion destroys the voxel');
  assert(grid.get(2, 2, 2) === Voxel.Air, 'destroyed voxel becomes air');

  grid.set(0, 2, 2, Voxel.Bedrock);
  const denied = grid.applyDamage(0, 2, 2, 999);
  assert(denied === null, 'bedrock ignores damage');
  assert(grid.get(0, 2, 2) === Voxel.Bedrock, 'bedrock remains');
}

function testCollision(): void {
  const grid = new VoxelGrid(8, 8, 8);
  grid.fill(Voxel.Air);
  grid.set(3, 3, 3, Voxel.Rock);
  const pos = { x: 3.5, y: 3.5, z: 3.5 };
  grid.resolveSphere(pos, 0.4);
  const nearestX = Math.max(3, Math.min(4, pos.x));
  const nearestY = Math.max(3, Math.min(4, pos.y));
  const nearestZ = Math.max(3, Math.min(4, pos.z));
  const dist = Math.hypot(pos.x - nearestX, pos.y - nearestY, pos.z - nearestZ);
  assert(dist >= 0.4 - 1e-3, `sphere should exit the voxel, dist=${dist}`);
}

function testCarveSkipsBedrock(): void {
  const grid = new VoxelGrid(10, 10, 10);
  grid.fill(Voxel.Rock);
  for (let z = 0; z < 10; z++) {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (x === 0 || y === 0 || z === 0) grid.set(x, y, z, Voxel.Bedrock);
      }
    }
  }
  grid.clearSphere(2, 2, 2, 3);
  assert(grid.get(0, 2, 2) === Voxel.Bedrock, 'sphere carve leaves bedrock');
  assert(grid.get(2, 2, 2) === Voxel.Air, 'sphere carve removes interior rock');
}

function testRules(): void {
  assert(depthMeters(40, 28) === 12, 'depth is downward distance');
  assert(scoreMultiplier(0) === 1, 'surface multiplier is 1');
  assert(scoreMultiplier(16) === 2, 'multiplier climbs with depth');
  assert(laserProfile(1).splashDamage === 0, 'early laser is precise');
  assert(laserProfile(5).splashDamage > 0, 'late laser bores neighbors');
  assert(chargeProfile(6).radius > chargeProfile(1).radius, 'charges grow with tier');
  assert(tierFromOre(4, 8) === 5, 'ore upgrades stack on the saved tier');
  assert(tierFromOre(6, 40) === 6, 'tier caps at 6');
}

function reachesCore(grid: VoxelGrid): boolean {
  const start = grid.index(Math.floor(grid.spawn.x), Math.floor(grid.spawn.y), Math.floor(grid.spawn.z));
  const seen = new Uint8Array(grid.cellCount);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const cell = grid.coords(current);
    for (const dir of DIRS) {
      const nx = cell.x + dir.x;
      const ny = cell.y + dir.y;
      const nz = cell.z + dir.z;
      if (!grid.inBounds(nx, ny, nz)) continue;
      const next = grid.index(nx, ny, nz);
      if (grid.types[next] === Voxel.Core) return true;
      if (grid.types[next] !== Voxel.Air || seen[next]) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return false;
}

function testWorld(): void {
  const started = performance.now();
  const grid = new VoxelGrid(WORLD_X, WORLD_Y, WORLD_Z);
  const first = grid.generate(12345);
  const again = new VoxelGrid(WORLD_X, WORLD_Y, WORLD_Z).generate(12345);
  const other = new VoxelGrid(WORLD_X, WORLD_Y, WORLD_Z).generate(98765);
  assert(first.air === again.air, 'generation is deterministic for a seed');
  assert(first.air !== other.air, 'different seeds carve different caverns');
  assert(grid.get(Math.floor(grid.spawn.x), Math.floor(grid.spawn.y), Math.floor(grid.spawn.z)) === Voxel.Air, 'spawn is open air');
  assert(reachesCore(grid), 'the bore path reaches a core crystal');
  let cores = 0;
  for (let i = 0; i < grid.cellCount; i++) if (grid.types[i] === Voxel.Core) cores++;
  assert(cores > 0, 'core cluster is placed');
  const ms = performance.now() - started;
  console.log(
    `world seed 12345: air=${first.air} emitters=${first.emitters} cores=${cores} gen=${ms.toFixed(0)}ms`,
  );
}

function main(): void {
  testRaycast();
  testDamageAndBedrock();
  testCollision();
  testCarveSkipsBedrock();
  testRules();
  testWorld();
  console.log('voxel breaker tests passed');
}

main();
