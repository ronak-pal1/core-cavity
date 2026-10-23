import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';
import * as THREE from 'three/webgpu';

export class GameScene {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  backendName = 'WebGPU';
  private pipeline: THREE.RenderPipeline | null = null;

  constructor(root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.canvas.className = 'absolute inset-0 z-0';
    root.append(this.canvas);
    this.renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.06, 160);
    this.scene.background = new THREE.Color(0x03060c);
    this.resize();
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const scenePass = pass(this.scene, this.camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneColor, 0.36, 0.46, 0.78);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = sceneColor.add(bloomPass);
    this.backendName = 'isWebGPUBackend' in this.renderer.backend ? 'WebGPU' : 'WebGL2';
  }

  resize(): void {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
  }

  render(): void {
    this.pipeline?.render();
  }
}
