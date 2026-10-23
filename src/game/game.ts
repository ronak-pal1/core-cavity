import { VOXEL_SPARK } from './materials';
import { AudioEngine } from './audio';
import { Input } from './input';
import { emitterLight, LightField, nearestEmitters, packLights, type LightSample } from './lighting';
import { createCaveMaterial, createEngineMaterial, createGlassMaterial, createHullMaterial } from './materials';
import { ParticleSystem } from './particles';
import { clearSave, loadSave, recordRun, type SaveData } from './persistence';
import { Player, type MoveInput } from './player';
import { chargeProfile, depthMeters, hazardLabel, laserProfile, pointsFor, scoreMultiplier, tierFromOre } from './rules';
import { GameScene } from './scene';
import { Terrain } from './terrain';
import { Voxel, type DigResult, type MineEvent } from './types';
import { Hud, type HudSnapshot } from './ui';
import { Weapons } from './weapons';
import * as THREE from 'three/webgpu';

type Mode = HudSnapshot['mode'];

export class Game {
  private readonly hud: Hud;
  private readonly audio = new AudioEngine();
  private readonly view: GameScene;
  private readonly input: Input;
  private readonly lights = new LightField();
  private readonly cave;
  private readonly engine;
  private readonly terrain: Terrain;
  private readonly player: Player;
  private readonly weapons: Weapons;
  private readonly particles: ParticleSystem;
  private readonly laserEnd = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly laserPoint = new THREE.Vector3();
  private readonly blastPoint = new THREE.Vector3();
  private save: SaveData;
  private mode: Mode = 'boot';
  private boot = 'Igniting bore systems';
  private fatal = '';
  private score = 0;
  private ore = 0;
  private maxDepth = 0;
  private runStartTier = 1;
  private shake = 0;
  private flash = 0;
  private sparkTimer = 0;
  private hurtTimer = 0;
  private chargeWindow = 1;
  private victoryTimer = 0;
  private victoryLatched = false;
  private pristine = true;
  private runCommitted = true;
  private lockSuppressed = false;
  private laserActive = false;
  private endReason = '';
  private fps = 0;
  private fpsTime = 0;
  private fpsFrames = 0;
  private lastTime = -1;
  private menuYaw = 0.4;
  private readonly toasts: { text: string; life: number }[] = [];

  constructor(root: HTMLElement) {
    this.hud = new Hud(root);
    this.view = new GameScene(root);
    this.input = new Input(this.view.canvas);
    this.cave = createCaveMaterial(this.lights);
    this.engine = createEngineMaterial();
    const glass = createGlassMaterial();
    const hull = createHullMaterial(this.lights);
    this.terrain = new Terrain(this.view.scene, this.cave.material);
    this.player = new Player(this.view.scene, { hull, engine: this.engine.material, glass });
    this.weapons = new Weapons(this.view.scene);
    this.particles = new ParticleSystem(this.view.scene);
    this.save = loadSave();
    this.runStartTier = this.save.laserTier;
    this.hud.onAction((action) => this.onAction(action));
    window.addEventListener('resize', () => this.view.resize());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.view.canvas;
      if (!locked && this.mode === 'play' && !this.lockSuppressed) this.mode = 'pause';
    });
    this.hud.update(this.snapshot());
    void this.bootSequence();
  }

  private async bootSequence(): Promise<void> {
    try {
      this.boot = 'Igniting WebGPU renderer';
      this.hud.update(this.snapshot());
      await this.view.init();
      this.boot = 'Carving the Deep Core shaft';
      this.hud.update(this.snapshot());
      await nextFrame();
      this.terrain.generate((Math.random() * 0x7fffffff) | 0);
      this.player.reset({ x: this.terrain.spawn.x, y: this.terrain.spawn.y, z: this.terrain.spawn.z }, this.save.laserTier);
      this.menuYaw = this.player.yaw;
      this.boot = 'Spooling 20,480 compute particles';
      this.hud.update(this.snapshot());
      await nextFrame();
      this.particles.reset(this.view.renderer);
      this.pristine = true;
      this.mode = 'menu';
      this.view.renderer.setAnimationLoop((time) => this.frame(time));
    } catch (error) {
      this.fatal = error instanceof Error ? error.message : String(error);
      this.mode = 'boot';
      this.hud.update(this.snapshot());
    }
  }

  private frame(time: number): void {
    if (this.lastTime < 0) {
      this.lastTime = time;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.fpsTime += dt;
    this.fpsFrames += 1;
    if (this.fpsTime >= 0.35) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.sparkTimer = Math.max(0, this.sparkTimer - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.flash = Math.max(0, this.flash - dt * 1.7);
    this.shake = Math.max(0, this.shake - dt * 1.65);
    this.decayToasts(dt);

    if (this.mode === 'menu') {
      this.menuYaw += dt * 0.12;
      this.player.yaw = this.menuYaw;
      this.player.pitch = -0.45;
      this.player.syncCamera(this.view.camera, this.terrain.grid, 0);
    } else if (this.mode === 'play') {
      this.look(dt);
      this.player.move(dt, this.moveInput(), this.terrain.grid);
      this.player.syncCamera(this.view.camera, this.terrain.grid, this.shake);
      this.handleLaser(dt);
      this.handleCharge();
      this.applyEnvironment(dt);
      this.drainFuel(dt);
      this.trackDepth();
      if (this.victoryLatched) {
        this.mode = 'resolving';
        this.victoryTimer = 1.45;
        this.releaseTrigger();
      } else if (this.player.health <= 0) {
        this.endReason = 'Rig integrity collapsed under the cavern.';
        this.finish('dead');
      } else if (this.player.fuel <= 0) {
        this.endReason = 'Fuel reserves empty. The rig went dark.';
        this.finish('dead');
      }
    } else if (this.mode === 'resolving') {
      this.player.syncCamera(this.view.camera, this.terrain.grid, this.shake);
      this.victoryTimer -= dt;
      if (this.victoryTimer <= 0) this.finish('victory');
    } else if (this.mode === 'pause') {
      this.player.syncCamera(this.view.camera, this.terrain.grid, 0);
      this.releaseTrigger();
    }

    if (this.mode === 'play' && this.input.consumePress('Escape')) {
      this.lockSuppressed = true;
      if (document.pointerLockElement) document.exitPointerLock();
      this.releaseTrigger();
      this.mode = 'pause';
    }
    if (this.input.consumePress('KeyM')) this.audio.toggleMute();
    this.weapons.update(dt);
    this.engine.thrust.value = this.player.thrust;
    this.cave.danger.value = Math.min(1, depthMeters(this.terrain.spawn.y, this.player.position.y) / 52);
    this.syncLights();
    this.particles.setPlayer(this.player.position);
    this.particles.setDt(dt);
    this.particles.update(this.view.renderer);
    this.terrain.flush();
    this.audio.updateDrone(dt, this.maxDepth, this.mode === 'play' || this.mode === 'resolving');
    if (this.mode === 'play' && this.player.fuel < 25) this.audio.fuelWarning();
    this.view.render();
    this.hud.update(this.snapshot());
    this.input.endFrame();
  }

  private look(dt: number): void {
    const pointer = this.input.consumeLook();
    let yaw = pointer.x * 0.00215;
    let pitch = pointer.y * 0.00175;
    const speed = 1.7 * dt;
    if (this.input.held.has('KeyL')) yaw += speed;
    if (this.input.held.has('KeyJ')) yaw -= speed;
    if (this.input.held.has('KeyI')) pitch -= speed;
    if (this.input.held.has('KeyK')) pitch += speed;
    this.player.addLook(yaw, pitch);
  }

  private moveInput(): MoveInput {
    const held = this.input.held;
    return {
      forward: held.has('KeyW') || held.has('ArrowUp'),
      back: held.has('KeyS') || held.has('ArrowDown'),
      left: held.has('KeyA') || held.has('ArrowLeft'),
      right: held.has('KeyD') || held.has('ArrowRight'),
      up: held.has('KeyQ'),
      down: held.has('KeyE') || held.has('KeyC'),
      boost: held.has('ShiftLeft') || held.has('ShiftRight'),
    };
  }

  private handleLaser(dt: number): void {
    const firing = this.input.mouseDown || this.input.held.has('KeyF');
    if (!firing || this.player.fuel <= 0) {
      this.releaseTrigger();
      return;
    }
    const profile = laserProfile(this.player.tier);
    this.player.fuel = Math.max(0, this.player.fuel - profile.fuelPerSecond * dt);
    const origin = this.view.camera.position;
    const direction = this.player.forward;
    const hit = this.terrain.raycast(origin, direction, profile.range);
    this.player.getMuzzle(this.muzzle);
    if (hit) {
      this.laserEnd.set(hit.px, hit.py, hit.pz);
      this.laserPoint.copy(this.laserEnd);
      this.laserActive = true;
      const dug = this.terrain.damageAt(hit.x, hit.y, hit.z, profile.damagePerSecond * dt, profile.splashDamage);
      if (dug.hit && !dug.hit.destroyed && this.sparkTimer <= 0) {
        const tint = VOXEL_SPARK[dug.hit.type] ?? VOXEL_SPARK[Voxel.Rock]!;
        this.particles.burst(hit.px, hit.py, hit.pz, tint, 8, 2.4, 0.35);
        this.sparkTimer = 0.045;
      }
      this.applyDig(dug, 'laser');
    } else {
      this.laserEnd.copy(origin).addScaledVector(direction, profile.range);
      this.laserActive = false;
    }
    this.weapons.setLaser(this.muzzle, this.laserEnd);
    this.audio.setLaser(true);
  }

  private handleCharge(): void {
    if (!this.input.consumePress('Space') && !this.input.consumePress('KeyG')) return;
    const profile = chargeProfile(this.player.tier);
    if (this.weapons.cooldown > 0) {
      this.pushToast('SEISMIC CHARGE CYCLING');
      return;
    }
    if (this.player.fuel < profile.fuelCost) {
      this.pushToast('CHARGE NEEDS FUEL');
      return;
    }
    this.player.fuel -= profile.fuelCost;
    const origin = this.view.camera.position;
    const direction = this.player.forward;
    const hit = this.terrain.raycast(origin, direction, profile.range);
    const x = hit ? hit.px : origin.x + direction.x * profile.range;
    const y = hit ? hit.py : origin.y + direction.y * profile.range;
    const z = hit ? hit.pz : origin.z + direction.z * profile.range;
    const dug = this.terrain.carveSphere(x, y, z, profile.radius);
    this.weapons.blast(x, y, z, profile.radius);
    this.weapons.cooldown = profile.cooldown;
    this.chargeWindow = profile.cooldown;
    this.particles.burst(x, y, z, [1, 0.62, 0.22], 420, 9.5, 0.7);
    this.shake = Math.min(1.6, this.shake + 0.9);
    this.flash = Math.min(1, this.flash + 0.35);
    this.audio.charge();
    const distance = this.player.position.distanceTo(this.blastPoint.set(x, y, z));
    if (distance < profile.radius + 1.3 && !this.victoryLatched) {
      const falloff = 1 - distance / (profile.radius + 1.3);
      this.hurt(24 * falloff);
    }
    this.applyDig(dug, 'charge');
  }

  private applyEnvironment(dt: number): void {
    if (this.player.touchingLava) this.hurt(20 * dt);
    const depth = depthMeters(this.terrain.spawn.y, this.player.position.y);
    const aura = 1.15 + depth / 90;
    const aura2 = aura * aura;
    let shards = 0;
    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;
    for (const emitter of this.terrain.grid.emitters) {
      if (emitter.type !== Voxel.Hazard) continue;
      const dx = emitter.x + 0.5 - px;
      const dy = emitter.y + 0.5 - py;
      const dz = emitter.z + 0.5 - pz;
      if (dx * dx + dy * dy + dz * dz <= aura2) shards += 1;
    }
    if (shards > 0) this.hurt(Math.min(3, shards) * 7.5 * dt);
  }

  private drainFuel(dt: number): void {
    let drain = 1.12;
    if (this.player.moving) drain += 1.05;
    if (this.player.boosting) drain += 2.15;
    this.player.fuel = Math.max(0, this.player.fuel - drain * dt);
  }

  private trackDepth(): void {
    this.maxDepth = Math.max(this.maxDepth, depthMeters(this.terrain.spawn.y, this.player.position.y));
  }

  private applyDig(result: DigResult, kind: 'laser' | 'charge'): void {
    const depth = depthMeters(this.terrain.spawn.y, this.player.position.y);
    const multiplier = scoreMultiplier(depth);
    const counts = new Map<Voxel, number>();
    let hazardDamage = 0;
    for (const event of result.events) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
      this.score += pointsFor(event.type, multiplier);
      if (event.type === Voxel.Ore) this.ore += 1;
      if (event.type === Voxel.Energy) this.player.refill(36, 16);
      if (event.type === Voxel.Core) this.latchVictory(event);
      if (event.type === Voxel.Hazard) {
        const dx = event.x + 0.5 - this.player.position.x;
        const dy = event.y + 0.5 - this.player.position.y;
        const dz = event.z + 0.5 - this.player.position.z;
        const distance = Math.hypot(dx, dy, dz);
        hazardDamage += 34 * (1 - Math.min(1, distance / 4.8));
      }
      if (kind === 'charge' && event.type === Voxel.Rock) continue;
      const tint = VOXEL_SPARK[event.type] ?? VOXEL_SPARK[Voxel.Rock]!;
      const count = event.type === Voxel.Hazard ? 56 : event.type === Voxel.Core ? 80 : 16;
      const speed = event.type === Voxel.Hazard ? 7.5 : 3.6;
      this.particles.burst(event.x + 0.5, event.y + 0.5, event.z + 0.5, tint, count, speed, 0.62);
    }
    if (hazardDamage > 0 && !this.victoryLatched) {
      this.hurt(Math.min(46, hazardDamage));
      this.shake = Math.min(1.5, this.shake + 0.5);
    }
    const nextTier = tierFromOre(this.runStartTier, this.ore);
    if (nextTier > this.player.tier) {
      this.player.tier = nextTier;
      this.pushToast(`LASER UPGRADED TO T${nextTier}`);
      this.audio.pickup('upgrade');
    }
    this.announce(counts, multiplier);
  }

  private announce(counts: Map<Voxel, number>, multiplier: number): void {
    const ore = counts.get(Voxel.Ore) ?? 0;
    if (ore > 0) {
      this.pushToast(`ORE x${ore}  +${pointsFor(Voxel.Ore, multiplier) * ore}`);
      this.audio.pickup('ore');
    }
    const energy = counts.get(Voxel.Energy) ?? 0;
    if (energy > 0) {
      this.pushToast(`ENERGY CELL x${energy}`);
      this.audio.pickup('energy');
    }
    const hazard = counts.get(Voxel.Hazard) ?? 0;
    if (hazard > 0) this.pushToast(`VOID SHARD x${hazard}`);
    if ((counts.get(Voxel.Core) ?? 0) > 0) this.pushToast('CORE CRYSTAL EXTRACTED');
  }

  private latchVictory(event: MineEvent): void {
    if (this.victoryLatched) return;
    this.victoryLatched = true;
    this.player.health = Math.max(this.player.health, 1);
    this.player.fuel = Math.max(this.player.fuel, 1);
    this.endReason = 'The Deep Core is in the hold.';
    this.audio.victory();
    this.particles.burst(event.x + 0.5, event.y + 0.5, event.z + 0.5, VOXEL_SPARK[Voxel.Core]!, 160, 8, 0.95);
    this.shake = 1.25;
  }

  private hurt(amount: number): void {
    const dealt = this.player.applyDamage(amount);
    if (dealt <= 0) return;
    this.flash = Math.min(1, this.flash + Math.min(0.7, dealt / 40));
    if (this.hurtTimer <= 0) {
      this.audio.hurt();
      this.hurtTimer = 0.28;
    }
  }

  private syncLights(): void {
    const position = this.player.position;
    const forward = this.player.forward;
    const lights: LightSample[] = [
      {
        x: position.x + forward.x * 1.35,
        y: position.y + forward.y * 1.35 + 0.15,
        z: position.z + forward.z * 1.35,
        radius: 11,
        r: 0.72,
        g: 0.88,
        b: 1,
        intensity: 2.4,
      },
      {
        x: position.x,
        y: position.y,
        z: position.z,
        radius: 5.5,
        r: 0.45,
        g: 0.62,
        b: 1,
        intensity: 0.7,
      },
    ];
    if (this.laserActive) {
      lights.push({
        x: this.laserPoint.x,
        y: this.laserPoint.y,
        z: this.laserPoint.z,
        radius: 6.2,
        r: 0.35,
        g: 0.95,
        b: 1,
        intensity: 3.2,
      });
    }
    for (const explosion of this.weapons.explosionLights()) {
      lights.push({
        x: explosion.x,
        y: explosion.y,
        z: explosion.z,
        radius: explosion.radius,
        r: 1,
        g: 0.5,
        b: 0.12,
        intensity: explosion.intensity,
      });
    }
    const room = 12 - lights.length;
    if (room > 0) {
      const nearby = nearestEmitters(this.terrain.grid.emitters, position.x, position.y, position.z, room, 26);
      for (const emitter of nearby) lights.push(emitterLight(emitter));
    }
    packLights(this.lights, lights);
  }

  private async begin(forceRegen: boolean): Promise<void> {
    this.audio.unlock();
    if (forceRegen || !this.pristine) {
      this.mode = 'boot';
      this.boot = 'Retargeting bore path';
      this.fatal = '';
      this.hud.update(this.snapshot());
      await nextFrame();
      this.terrain.generate((Math.random() * 0x7fffffff) | 0);
      this.particles.reset(this.view.renderer);
      this.player.yaw = Math.random() * Math.PI * 2;
    }
    this.pristine = false;
    this.runCommitted = false;
    this.victoryLatched = false;
    this.score = 0;
    this.ore = 0;
    this.maxDepth = 0;
    this.shake = 0;
    this.flash = 0;
    this.toasts.length = 0;
    this.endReason = '';
    this.runStartTier = this.save.laserTier;
    this.chargeWindow = 1;
    this.weapons.cooldown = 0;
    this.player.reset({ x: this.terrain.spawn.x, y: this.terrain.spawn.y, z: this.terrain.spawn.z }, this.runStartTier);
    this.releaseTrigger();
    this.lockSuppressed = false;
    this.mode = 'play';
    void this.view.canvas.requestPointerLock();
  }

  private finish(kind: 'victory' | 'dead' | 'menu'): void {
    this.commitRun(kind === 'victory');
    this.releaseTrigger();
    this.lockSuppressed = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (kind === 'menu') {
      this.mode = 'menu';
      this.menuYaw = this.player.yaw;
      return;
    }
    this.mode = kind;
    if (kind === 'dead') this.audio.defeat();
  }

  private commitRun(victory: boolean): void {
    if (this.runCommitted) return;
    this.runCommitted = true;
    this.save = recordRun(this.save, {
      score: this.score,
      depth: this.maxDepth,
      tier: this.player.tier,
      victory,
    });
  }

  private releaseTrigger(): void {
    this.laserActive = false;
    this.weapons.setLaser(null, null);
    this.audio.setLaser(false);
  }

  private onAction(action: string): void {
    if (action === 'engage') void this.begin(false);
    if (action === 'retry') void this.begin(true);
    if (action === 'resume') {
      this.lockSuppressed = false;
      this.mode = 'play';
      void this.view.canvas.requestPointerLock();
    }
    if (action === 'menu' && this.mode !== 'menu' && this.mode !== 'boot') this.finish('menu');
    if (action === 'reset-save') this.save = clearSave();
    if (action === 'mute') this.audio.toggleMute();
  }

  private pushToast(text: string): void {
    this.toasts.unshift({ text, life: 2.5 });
    if (this.toasts.length > 4) this.toasts.length = 4;
  }

  private decayToasts(dt: number): void {
    for (const toast of this.toasts) toast.life -= dt;
    while (this.toasts.length > 0 && (this.toasts[this.toasts.length - 1]?.life ?? 0) <= 0) this.toasts.pop();
  }

  private snapshot(): HudSnapshot {
    const depth = depthMeters(this.terrain.spawn.y, this.player.position.y);
    const forward = this.player.forward;
    const toX = this.terrain.core.x - this.player.position.x;
    const toZ = this.terrain.core.z - this.player.position.z;
    const bearing = Math.atan2(forward.x * toZ - forward.z * toX, forward.x * toX + forward.z * toZ);
    const coreDistance = Math.hypot(toX, this.terrain.core.y - this.player.position.y, toZ);
    const charge = this.chargeWindow <= 0 ? 1 : 1 - this.weapons.cooldown / this.chargeWindow;
    return {
      mode: this.mode,
      boot: this.boot,
      fatal: this.fatal,
      health: this.player.health,
      fuel: this.player.fuel,
      score: Math.round(this.score),
      ore: this.ore,
      tier: this.player.tier,
      depth,
      multiplier: scoreMultiplier(depth),
      hazard: hazardLabel(depth),
      coreDistance,
      bearing,
      charge: Math.max(0, Math.min(1, charge)),
      fps: this.fps,
      objective: this.victoryLatched ? 'CORE SECURED' : 'EXTRACT THE DEEP CORE',
      toasts: this.toasts.map((toast) => toast.text),
      flash: this.flash,
      lowFuel: this.player.fuel < 25,
      backend: this.view.backendName,
      faceCount: this.terrain.faceCount,
      save: this.save,
      endTitle: this.mode === 'victory' ? 'CORE EXTRACTED' : 'RIG LOST',
      endBody: this.endCopy(),
      muted: this.audio.isMuted,
    };
  }

  private endCopy(): string {
    if (this.mode !== 'victory' && this.mode !== 'dead') return '';
    return `${this.endReason}\nScore ${Math.round(this.score).toLocaleString('en-US')}    Depth ${this.maxDepth.toFixed(1)}m    Ore ${this.ore}\nLaser T${this.player.tier}    Career best ${this.save.highScore.toLocaleString('en-US')}`;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
