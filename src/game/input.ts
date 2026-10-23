export class Input {
  readonly held = new Set<string>();
  mouseDown = false;
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private rightDown = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (event) => {
      if (BLOCKED.has(event.code)) event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.held.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
    target.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.mouseDown = true;
      if (event.button === 2) this.rightDown = true;
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouseDown = false;
      if (event.button === 2) this.rightDown = false;
    });
    window.addEventListener('mousemove', (event) => {
      const locked = document.pointerLockElement === this.target;
      if (!locked && !this.rightDown) return;
      this.lookX += event.movementX;
      this.lookY += event.movementY;
    });
    target.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  consumeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}

const BLOCKED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
