export interface Noise {
  hash3(x: number, y: number, z: number): number;
  fbm(x: number, y: number, z: number): number;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

export function makeNoise(seed: number): Noise {
  const s = seed | 0;

  function hash3(x: number, y: number, z: number): number {
    let n =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 2147483647) ^
      Math.imul(s, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x: number, y: number, z: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const tz = fade(z - z0);
    let acc = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const h = hash3(x0 + dx, y0 + dy, z0 + dz);
          const wx = dx ? tx : 1 - tx;
          const wy = dy ? ty : 1 - ty;
          const wz = dz ? tz : 1 - tz;
          acc += h * wx * wy * wz;
        }
      }
    }
    return acc;
  }

  function fbm(x: number, y: number, z: number): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let weight = 0;
    for (let octave = 0; octave < 3; octave++) {
      sum += valueNoise(x * frequency, y * frequency, z * frequency) * amplitude;
      weight += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / weight;
  }

  return { hash3, fbm };
}
