# Voxel Breaker: Deep Core Mining

A single-player underground mining game built with Three.js WebGPU, TSL, Vite, TypeScript, and Tailwind CSS. Fly a hovering bore rig through a procedural cavern, cut rock with a plasma laser, blast tunnels with seismic charges, and extract the Deep Core.

## Run

```bash
npm install
npm run dev
```

Open the local URL. A WebGPU-capable browser is the target. If WebGPU is missing, the renderer falls back to WebGL2 and the same game loop still runs.

```bash
npm test
npm run typecheck
npm run build
```

## Controls

- **WASD / arrows** fly in the look direction
- **Mouse** aims (pointer lock, or hold right mouse)
- **I J K L** keyboard look
- **Q / E** vertical strafe (`C` also descends)
- **Shift** boost
- **Left click** or **F** plasma laser
- **Space** or **G** seismic charge
- **M** mute
- **Esc** releases the mouse and pauses

## Loop

Ore raises score and, every 8 crystals, the laser tier. Tiers persist in `localStorage` along with the high score, best depth, and cores extracted. Energy cells refill fuel and patch the hull. Depth increases the score multiplier and the amount of void shards and lava. Mining a core crystal wins. Empty fuel or a broken hull ends the run.

## Layout

- `src/game/scene.ts` — WebGPU renderer, bloom pipeline, camera
- `src/game/terrain.ts` — instanced cave faces and live carving
- `src/game/voxelGrid.ts` — procedural cavern, DDA raycast, collision
- `src/game/player.ts` — hovering rig
- `src/game/particles.ts` — 20,480 compute-driven particles
- `src/game/lighting.ts` — storage-buffer point lights
- `src/game/materials.ts` — TSL cave, crystal, lava, and fog shaders
- `src/game/ui.ts` — sci-fi HUD and menus
