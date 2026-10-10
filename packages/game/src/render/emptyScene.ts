/**
 * 空场景（M6 验收：three 在小游戏上渲染「三色道 + 地平线」，S3 任务 3）。
 * 从跑酷正场景抽出的最小复现：只搭地面/三车道/护栏/流动虚线（复用 trackVisuals）+
 * 天穹底色/雾做地平线，固定相机、常速滚动，不依赖 sim 与玩法配置。
 * 只经 PlatformAdapter 拿画布与时钟——两端（web ?scene=empty / wx 模拟器）跑同一份代码。
 */
import * as THREE from 'three';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { createTrackVisuals } from './trackVisuals.js';

/** theme_neon_city 的默认配色（docs/05 场景元素；与 runnerScene 同源但此处不读配置） */
const SKY_BASE = '#0B1226', SKY_FLASH = '#9FD8FF', TINT = '#7FD1FF';
/** 空场景相机与滚动速度（纯观感参数，非玩法数值） */
const CAM_Y = 1.9, CAM_Z = 7.4, LOOK_Z = -11, FOV = 55, SCROLL_SPEED = 12;

export interface EmptySceneHandle {
  dispose(): void;
  /** 当前帧率（onFrame 统计，devtools 性能面板交叉核对用） */
  fps(): number;
}

export function createEmptyScene(adapter: PlatformAdapter): EmptySceneHandle {
  const canvas = adapter.canvas.mainCanvas();
  const size = adapter.canvas.windowSize();

  // 与 runnerScene 同一单点断言约定（S10 §7.6）：结构化 GLCanvas → three 的 canvas 形貌
  const renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: true });
  renderer.setPixelRatio(size.dpr);
  renderer.setSize(size.width, size.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_BASE);
  scene.fog = new THREE.Fog(SKY_BASE, 22, 120); // 远端收进天穹色 = 地平线
  const camera = new THREE.PerspectiveCamera(FOV, size.width / size.height, 0.1, 200);
  camera.position.set(0, CAM_Y, CAM_Z);
  camera.lookAt(0, 0, LOOK_Z);
  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0c1020, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(3, 8, 4);
  scene.add(keyLight);

  const track = createTrackVisuals(scene, 2.2, { baseColor: SKY_BASE, flashColor: SKY_FLASH, tint: TINT });
  const offResize = adapter.canvas.onResize(s => {
    renderer.setPixelRatio(s.dpr);
    renderer.setSize(s.width, s.height, false);
    camera.aspect = s.width / s.height;
    camera.updateProjectionMatrix();
  });

  let raf = 0, last = adapter.now(), dist = 0, frames = 0, fps = 0, fpsClock = last, running = true;
  function tick(nowMs: number) {
    if (!running) return;
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    dist += dt * SCROLL_SPEED;
    track.update(dist);
    renderer.render(scene, camera);
    frames++;
    if (nowMs - fpsClock >= 1000) { fps = frames * 1000 / (nowMs - fpsClock); frames = 0; fpsClock = nowMs; }
    raf = adapter.requestFrame(tick);
  }
  raf = adapter.requestFrame(tick);

  return {
    dispose() {
      running = false;
      adapter.cancelFrame(raf);
      offResize();
      track.dispose();
      renderer.dispose();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose());
      });
    },
    fps: () => fps,
  };
}
