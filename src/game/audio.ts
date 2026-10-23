type Oscillator = OscillatorNode;

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private laser: Oscillator | null = null;
  private laserGain: GainNode | null = null;
  private drone: Oscillator | null = null;
  private droneGain: GainNode | null = null;
  private muted = false;
  private warning = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    const context = this.ensure();
    if (context.state === 'suspended') void context.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.18;
    return this.muted;
  }

  setLaser(active: boolean): void {
    if (!this.context || this.muted) {
      if (!active) this.stopLaser();
      return;
    }
    if (active && !this.laser) this.startLaser();
    if (!active) this.stopLaser();
  }

  charge(): void {
    this.burst(70, 0.35, 'sawtooth', 0.5);
    this.noise(0.28);
  }

  pickup(kind: 'ore' | 'energy' | 'upgrade'): void {
    if (kind === 'ore') this.tone(660, 0.08, 'sine', 0.22);
    else if (kind === 'energy') {
      this.tone(520, 0.07, 'sine', 0.2);
      this.tone(830, 0.1, 'sine', 0.16);
    } else {
      this.tone(440, 0.07, 'square', 0.12);
      this.tone(660, 0.09, 'square', 0.12);
      this.tone(880, 0.14, 'square', 0.1);
    }
  }

  hurt(): void {
    this.tone(110, 0.12, 'square', 0.18);
  }

  victory(): void {
    this.tone(523, 0.12, 'sine', 0.2);
    this.tone(659, 0.14, 'sine', 0.18);
    this.tone(784, 0.22, 'sine', 0.16);
  }

  defeat(): void {
    this.tone(220, 0.18, 'sawtooth', 0.16);
    this.tone(110, 0.34, 'sawtooth', 0.14);
  }

  updateDrone(dt: number, depth: number, active: boolean): void {
    this.warning = Math.max(0, this.warning - dt);
    if (!active || this.muted || !this.ensure()) {
      this.stopDrone();
      return;
    }
    if (!this.drone || !this.droneGain || !this.context) return;
    const frequency = Math.max(38, 62 - depth * 0.35);
    this.drone.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.2);
    this.droneGain.gain.setTargetAtTime(0.045, this.context.currentTime, 0.3);
  }

  fuelWarning(): void {
    if (this.warning > 0) return;
    this.warning = 1.15;
    this.tone(880, 0.07, 'square', 0.08);
  }

  private ensure(): AudioContext {
    if (this.context && this.master) return this.context;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.18;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    this.startDrone();
    return context;
  }

  private startDrone(): void {
    if (!this.context || !this.master || this.drone) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 55;
    gain.gain.value = 0.03;
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    this.drone = oscillator;
    this.droneGain = gain;
  }

  private stopDrone(): void {
    if (!this.droneGain || !this.context) return;
    this.droneGain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
  }

  private startLaser(): void {
    const context = this.ensure();
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 92;
    gain.gain.value = 0.045;
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    this.laser = oscillator;
    this.laserGain = gain;
  }

  private stopLaser(): void {
    if (!this.laser || !this.laserGain || !this.context) return;
    const gain = this.laserGain;
    const oscillator = this.laser;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
    oscillator.stop(this.context.currentTime + 0.08);
    this.laser = null;
    this.laserGain = null;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, level: number): void {
    if (this.muted) return;
    const context = this.ensure();
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(level, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

  private burst(frequency: number, duration: number, type: OscillatorType, level: number): void {
    if (this.muted) return;
    const context = this.ensure();
    if (!this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency * 3, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, context.currentTime + duration);
    gain.gain.setValueAtTime(level, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

  private noise(duration: number): void {
    if (this.muted) return;
    const context = this.ensure();
    if (!this.master) return;
    const frames = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.35;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }
}
