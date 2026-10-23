import { clampTier } from './rules';

const KEY = 'voxel-breaker-deep-core-v1';

export interface SaveData {
  highScore: number;
  bestDepth: number;
  laserTier: number;
  cores: number;
  runs: number;
}

export interface RunRecord {
  score: number;
  depth: number;
  tier: number;
  victory: boolean;
}

export function defaultSave(): SaveData {
  return { highScore: 0, bestDepth: 0, laserTier: 1, cores: 0, runs: 0 };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      highScore: Math.max(0, Number(parsed.highScore) || 0),
      bestDepth: Math.max(0, Number(parsed.bestDepth) || 0),
      laserTier: clampTier(Number(parsed.laserTier) || 1),
      cores: Math.max(0, Number(parsed.cores) || 0),
      runs: Math.max(0, Number(parsed.runs) || 0),
    };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode and full storage still leave the session playable.
  }
}

export function recordRun(current: SaveData, run: RunRecord): SaveData {
  const next: SaveData = {
    highScore: Math.max(current.highScore, Math.round(run.score)),
    bestDepth: Math.max(current.bestDepth, run.depth),
    laserTier: Math.max(clampTier(current.laserTier), clampTier(run.tier)),
    cores: current.cores + (run.victory ? 1 : 0),
    runs: current.runs + 1,
  };
  writeSave(next);
  return next;
}

export function clearSave(): SaveData {
  const fresh = defaultSave();
  writeSave(fresh);
  return fresh;
}
