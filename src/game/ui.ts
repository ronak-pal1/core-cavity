import type { SaveData } from './persistence';

export type HudAction = 'engage' | 'resume' | 'retry' | 'menu' | 'reset-save' | 'mute';

export interface HudSnapshot {
  mode: 'boot' | 'menu' | 'play' | 'pause' | 'resolving' | 'victory' | 'dead';
  boot: string;
  fatal: string;
  health: number;
  fuel: number;
  score: number;
  ore: number;
  tier: number;
  depth: number;
  multiplier: number;
  hazard: string;
  coreDistance: number;
  bearing: number;
  charge: number;
  fps: number;
  objective: string;
  toasts: string[];
  flash: number;
  lowFuel: boolean;
  backend: string;
  faceCount: number;
  save: SaveData;
  endTitle: string;
  endBody: string;
  muted: boolean;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly play: HTMLElement;
  private readonly boot: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly end: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly bootText: HTMLElement;
  private readonly fatalText: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly fuelFill: HTMLElement;
  private readonly healthValue: HTMLElement;
  private readonly fuelValue: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly oreValue: HTMLElement;
  private readonly tierValue: HTMLElement;
  private readonly depthValue: HTMLElement;
  private readonly multValue: HTMLElement;
  private readonly hazardValue: HTMLElement;
  private readonly coreValue: HTMLElement;
  private readonly chargeFill: HTMLElement;
  private readonly chargeLabel: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly bearing: HTMLElement;
  private readonly depthFill: HTMLElement;
  private readonly menuScore: HTMLElement;
  private readonly menuDepth: HTMLElement;
  private readonly menuTier: HTMLElement;
  private readonly menuCores: HTMLElement;
  private readonly menuFaces: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endBody: HTMLElement;
  private readonly backendValue: HTMLElement;
  private readonly muteButton: HTMLButtonElement;
  private handler: (action: HudAction) => void = () => undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.innerHTML = TEMPLATE;
    parent.append(this.root);
    this.play = this.need('#play-hud');
    this.boot = this.need('#boot');
    this.menu = this.need('#menu');
    this.pause = this.need('#pause');
    this.end = this.need('#end');
    this.flash = this.need('#flash');
    this.bootText = this.need('#boot-text');
    this.fatalText = this.need('#fatal-text');
    this.healthFill = this.need('#health-fill');
    this.fuelFill = this.need('#fuel-fill');
    this.healthValue = this.need('#health-value');
    this.fuelValue = this.need('#fuel-value');
    this.scoreValue = this.need('#score-value');
    this.oreValue = this.need('#ore-value');
    this.tierValue = this.need('#tier-value');
    this.depthValue = this.need('#depth-value');
    this.multValue = this.need('#mult-value');
    this.hazardValue = this.need('#hazard-value');
    this.coreValue = this.need('#core-value');
    this.chargeFill = this.need('#charge-fill');
    this.chargeLabel = this.need('#charge-label');
    this.fpsValue = this.need('#fps-value');
    this.objective = this.need('#objective');
    this.toasts = this.need('#toasts');
    this.bearing = this.need('#bearing');
    this.depthFill = this.need('#depth-fill');
    this.menuScore = this.need('#menu-score');
    this.menuDepth = this.need('#menu-depth');
    this.menuTier = this.need('#menu-tier');
    this.menuCores = this.need('#menu-cores');
    this.menuFaces = this.need('#menu-faces');
    this.endTitle = this.need('#end-title');
    this.endBody = this.need('#end-body');
    this.backendValue = this.need('#backend-value');
    this.muteButton = this.need('#mute') as HTMLButtonElement;
    this.root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action) return;
      this.handler(action as HudAction);
    });
  }

  onAction(handler: (action: HudAction) => void): void {
    this.handler = handler;
  }

  update(snapshot: HudSnapshot): void {
    const playing = snapshot.mode === 'play' || snapshot.mode === 'pause' || snapshot.mode === 'resolving';
    this.play.classList.toggle('hidden', !playing);
    this.boot.classList.toggle('hidden', snapshot.mode !== 'boot');
    this.menu.classList.toggle('hidden', snapshot.mode !== 'menu');
    this.pause.classList.toggle('hidden', snapshot.mode !== 'pause');
    this.end.classList.toggle('hidden', snapshot.mode !== 'victory' && snapshot.mode !== 'dead');
    this.bootText.textContent = snapshot.boot;
    this.fatalText.textContent = snapshot.fatal;
    this.fatalText.classList.toggle('hidden', snapshot.fatal.length === 0);
    this.healthFill.style.width = `${Math.max(0, Math.min(100, snapshot.health))}%`;
    this.fuelFill.style.width = `${Math.max(0, Math.min(100, snapshot.fuel))}%`;
    this.fuelFill.classList.toggle('bg-amber-400', snapshot.lowFuel);
    this.fuelFill.classList.toggle('bg-cyan-300', !snapshot.lowFuel);
    this.healthValue.textContent = `${Math.ceil(snapshot.health)}`;
    this.fuelValue.textContent = `${Math.ceil(snapshot.fuel)}`;
    this.scoreValue.textContent = snapshot.score.toLocaleString('en-US');
    this.oreValue.textContent = snapshot.ore.toString().padStart(3, '0');
    this.tierValue.textContent = `T${snapshot.tier}`;
    this.depthValue.textContent = `${snapshot.depth.toFixed(1)}m`;
    this.multValue.textContent = `x${snapshot.multiplier.toFixed(2)}`;
    this.hazardValue.textContent = snapshot.hazard;
    this.coreValue.textContent = `${snapshot.coreDistance.toFixed(0)}m`;
    this.chargeFill.style.width = `${Math.round(snapshot.charge * 100)}%`;
    this.chargeLabel.textContent = snapshot.charge >= 0.999 ? 'ARMED' : 'CHARGING';
    this.fpsValue.textContent = `${Math.round(snapshot.fps)} FPS`;
    this.objective.textContent = snapshot.objective;
    this.toasts.textContent = snapshot.toasts.join('   ');
    this.bearing.style.transform = `rotate(${snapshot.bearing}rad)`;
    this.depthFill.style.height = `${Math.max(4, Math.min(100, (snapshot.depth / 56) * 100))}%`;
    this.menuScore.textContent = snapshot.save.highScore.toLocaleString('en-US');
    this.menuDepth.textContent = `${snapshot.save.bestDepth.toFixed(0)}m`;
    this.menuTier.textContent = `T${snapshot.save.laserTier}`;
    this.menuCores.textContent = `${snapshot.save.cores}`;
    this.menuFaces.textContent = `${snapshot.backend} · ${snapshot.faceCount.toLocaleString('en-US')} FACES · 20,480 PARTICLES`;
    this.endTitle.textContent = snapshot.endTitle;
    this.endBody.textContent = snapshot.endBody;
    this.backendValue.textContent = snapshot.backend;
    this.muteButton.textContent = snapshot.muted ? 'AUDIO OFF' : 'AUDIO ON';
    this.flash.style.opacity = snapshot.flash.toFixed(3);
  }

  private need(selector: string): HTMLElement {
    const node = this.root.querySelector(selector);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing HUD node ${selector}`);
    return node;
  }
}

const PANEL = 'clip-hud pointer-events-auto border border-cyan-300/40 bg-slate-950/80 p-6 shadow-[0_0_40px_rgba(34,211,238,0.12)] backdrop-blur-md';
const BUTTON = 'pointer-events-auto border border-cyan-300/70 bg-cyan-400/10 px-5 py-3 font-display text-xs tracking-[0.22em] text-cyan-50 transition hover:bg-cyan-300/20';

const TEMPLATE = `
<div class="pointer-events-none fixed inset-0 z-20">
  <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]"></div>
  <div id="flash" class="absolute inset-0 bg-rose-500/50 mix-blend-screen opacity-0"></div>
  <section id="play-hud" class="absolute inset-0 hidden">
    <header class="absolute left-4 top-4 flex w-[min(440px,calc(100%-2rem))] flex-col gap-2 border border-cyan-400/30 bg-slate-950/70 p-3 backdrop-blur-sm">
      <div class="flex items-center justify-between font-display text-[11px] tracking-[0.28em] text-cyan-200">
        <span>VOXEL BREAKER</span>
        <span id="objective" class="text-amber-200"></span>
      </div>
      <label class="grid grid-cols-[64px_1fr_42px] items-center gap-2 text-[11px] text-rose-100">
        <span>HULL</span>
        <span class="clip-bar h-2 bg-rose-950/80"><span id="health-fill" class="block h-full bg-rose-400"></span></span>
        <span id="health-value" class="text-right">100</span>
      </label>
      <label class="grid grid-cols-[64px_1fr_42px] items-center gap-2 text-[11px] text-cyan-100">
        <span>FUEL</span>
        <span class="clip-bar h-2 bg-cyan-950/80"><span id="fuel-fill" class="block h-full bg-cyan-300"></span></span>
        <span id="fuel-value" class="text-right">100</span>
      </label>
    </header>
    <aside class="absolute right-4 top-4 w-52 border border-cyan-400/30 bg-slate-950/70 p-3 text-[12px] backdrop-blur-sm">
      <div class="flex items-center justify-between"><span class="text-cyan-300/80">SCORE</span><span id="score-value">0</span></div>
      <div class="mt-1 flex items-center justify-between"><span class="text-cyan-300/80">DEPTH</span><span id="depth-value">0m</span></div>
      <div class="mt-1 flex items-center justify-between"><span class="text-cyan-300/80">MULTIPLIER</span><span id="mult-value">x1.00</span></div>
      <div class="mt-1 flex items-center justify-between"><span class="text-cyan-300/80">STRATA</span><span id="hazard-value">STABLE</span></div>
      <div class="mt-2 flex items-center justify-between text-amber-200">
        <span class="flex items-center gap-2"><span id="bearing" class="inline-block text-base leading-none">▲</span> CORE</span>
        <span id="core-value">0m</span>
      </div>
    </aside>
    <div class="absolute bottom-24 right-6 h-36 w-2 border border-cyan-400/30 bg-slate-950/60">
      <div id="depth-fill" class="absolute bottom-0 w-full bg-gradient-to-t from-rose-500 to-cyan-300"></div>
    </div>
    <div class="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2">
      <span class="absolute left-0 top-0 h-2 w-2 border-l border-t border-cyan-200"></span>
      <span class="absolute right-0 top-0 h-2 w-2 border-r border-t border-cyan-200"></span>
      <span class="absolute bottom-0 left-0 h-2 w-2 border-b border-l border-cyan-200"></span>
      <span class="absolute bottom-0 right-0 h-2 w-2 border-b border-r border-cyan-200"></span>
      <span class="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100"></span>
    </div>
    <footer class="absolute bottom-4 left-1/2 flex w-[min(760px,calc(100%-2rem))] -translate-x-1/2 items-end justify-between gap-3 border border-cyan-400/30 bg-slate-950/75 p-3 backdrop-blur-sm">
      <div>
        <div class="text-[10px] tracking-[0.2em] text-cyan-300/70">ORE INVENTORY</div>
        <div id="ore-value" class="font-display text-2xl text-cyan-100">000</div>
      </div>
      <div class="min-w-36 flex-1">
        <div class="mb-1 flex justify-between text-[10px] tracking-[0.18em] text-cyan-300/70">
          <span id="tier-value">T1 LASER</span>
          <span id="charge-label">ARMED</span>
        </div>
        <div class="clip-bar h-2 bg-cyan-950/80"><div id="charge-fill" class="h-full w-full bg-amber-300"></div></div>
      </div>
      <div class="text-right text-[10px] leading-5 text-cyan-100/80">
        <div>WASD FLY · MOUSE AIM</div>
        <div>LMB/F LASER · SPACE CHARGE</div>
        <div>Q/E VERTICAL · SHIFT BOOST</div>
      </div>
    </footer>
    <div class="absolute bottom-24 left-4 text-[11px] text-cyan-100/80">
      <div id="toasts" class="max-w-md text-amber-200"></div>
      <div class="mt-1 flex gap-3">
        <span id="fps-value">0 FPS</span>
        <span id="backend-value">WebGPU</span>
        <button id="mute" data-action="mute" class="${BUTTON} px-2 py-1 text-[10px]">AUDIO ON</button>
      </div>
    </div>
  </section>
  <section id="boot" class="absolute inset-0 grid place-items-center">
    <div class="${PANEL} w-[min(460px,calc(100%-2rem))] text-center">
      <p class="font-display text-xs tracking-[0.35em] text-cyan-300">DEEP CORE MINING</p>
      <h1 class="mt-3 font-display text-2xl text-cyan-50">VOXEL BREAKER</h1>
      <p id="boot-text" class="mt-4 text-sm text-cyan-100/80">Igniting bore systems</p>
      <p id="fatal-text" class="mt-3 hidden text-sm text-rose-300"></p>
    </div>
  </section>
  <section id="menu" class="absolute inset-0 hidden grid place-items-center">
    <div class="${PANEL} w-[min(640px,calc(100%-2rem))]">
      <p class="font-display text-[11px] tracking-[0.35em] text-cyan-300">SUBTERRANEAN OPERATIONS</p>
      <h1 class="mt-2 font-display text-3xl text-cyan-50">VOXEL BREAKER</h1>
      <p class="mt-1 font-display text-sm tracking-[0.18em] text-amber-200">DEEP CORE MINING</p>
      <p class="mt-4 text-sm leading-6 text-cyan-100/85">Pilot a hovering bore rig through a procedural cavern. Mine glowing ore to raise the laser tier, keep the fuel cells alive, and dig down to the Deep Core. Depth multiplies the haul. Void shards and lava do not.</p>
      <div class="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div class="border border-cyan-400/20 p-2"><div class="text-cyan-300/70">BEST SCORE</div><div id="menu-score">0</div></div>
        <div class="border border-cyan-400/20 p-2"><div class="text-cyan-300/70">BEST DEPTH</div><div id="menu-depth">0m</div></div>
        <div class="border border-cyan-400/20 p-2"><div class="text-cyan-300/70">LASER TIER</div><div id="menu-tier">T1</div></div>
        <div class="border border-cyan-400/20 p-2"><div class="text-cyan-300/70">CORES</div><div id="menu-cores">0</div></div>
      </div>
      <p id="menu-faces" class="mt-3 text-[11px] text-cyan-200/70"></p>
      <div class="mt-5 flex flex-wrap gap-3">
        <button data-action="engage" class="${BUTTON}">ENGAGE DESCENT</button>
        <button data-action="reset-save" class="${BUTTON}">RESET SAVE</button>
      </div>
    </div>
  </section>
  <section id="pause" class="absolute inset-0 hidden grid place-items-center">
    <div class="${PANEL} w-[min(420px,calc(100%-2rem))] text-center">
      <h2 class="font-display text-xl tracking-[0.2em]">HOLD POSITION</h2>
      <p class="mt-3 text-sm text-cyan-100/80">Rig is idling. Fuel burn is suspended.</p>
      <div class="mt-5 flex justify-center gap-3">
        <button data-action="resume" class="${BUTTON}">RESUME</button>
        <button data-action="menu" class="${BUTTON}">ABORT TO MENU</button>
      </div>
    </div>
  </section>
  <section id="end" class="absolute inset-0 hidden grid place-items-center">
    <div class="${PANEL} w-[min(480px,calc(100%-2rem))] text-center">
      <h2 id="end-title" class="font-display text-2xl tracking-[0.14em]">CORE EXTRACTED</h2>
      <p id="end-body" class="mt-4 whitespace-pre-line text-sm leading-6 text-cyan-100/85"></p>
      <div class="mt-5 flex justify-center gap-3">
        <button data-action="retry" class="${BUTTON}">NEW SHAFT</button>
        <button data-action="menu" class="${BUTTON}">MENU</button>
      </div>
    </div>
  </section>
</div>
`;
