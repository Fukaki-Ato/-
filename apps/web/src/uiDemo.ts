/**
 * ?ui=demo —— S4 自绘 UI 验收演示页入口（独立于 bootstrap，平时立即返回）。
 * 全屏 canvas 盖在 DOM 壳上（z-index 1000），本页自建 WebGLRenderer；
 * S5 生产路径中 overlay 与主场景共享 renderer（createOverlay(host) 同一 API）。
 * 输入：v1 PlatformAdapter 无原始触点流（见 packages/ui/src/input/gestureAdapter.ts 的切换点说明），
 * demo 直接绑 pointer 事件（apps/* 允许 DOM），归一化为 UiInput（CSS px，t=秒）喂 overlay.handleInput。
 * 自动化探针：window.__trUiDemo = { overlay, view, handles, config }（S19b UI 快照的挂载点）。
 */
import * as THREE from 'three';
import {
  createOverlay, defaultThemeColors, loadFontSet, resolveUiConfig, UiView,
  type UiInput, type UiResources,
} from '@tr/framework/ui/index.js';
import { buildDemoView } from './uiDemoView.js';

if (new URLSearchParams(location.search).get('ui') === 'demo') {
  start().catch(showFatal);
}

function showFatal(err: unknown): void {
  const box = document.createElement('pre');
  box.textContent = `UI demo 启动失败：${err instanceof Error ? err.stack ?? err.message : String(err)}`;
  Object.assign(box.style, {
    position: 'fixed', inset: '0', zIndex: '2000', margin: '0', padding: '24px',
    background: '#0B1226', color: '#FF8F8F', font: '13px/1.6 monospace', whiteSpace: 'pre-wrap',
  });
  document.body.appendChild(box);
}

async function start(): Promise<void> {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    display: 'block', zIndex: '1000', touchAction: 'none',
  });
  document.body.appendChild(canvas);

  const dprOf = () => Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(dprOf());

  // web 侧资源实现：fetch（wx 侧 S6 换 extras.readJson/readBinary + wx.createImage，接口不变）
  const resources: UiResources = {
    async loadJson(path: string) {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return res.json();
    },
    async loadImage(path: string) {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return createImageBitmap(await res.blob());
    },
  };

  const [fonts, gameJson] = await Promise.all([
    loadFontSet(resources, '/assets/fonts'),
    resources.loadJson('/game.json'),
  ]);
  const config = resolveUiConfig((gameJson as { params?: unknown }).params);

  const viewSize = () => ({
    w: Math.max(1, canvas.clientWidth || window.innerWidth),
    h: Math.max(1, canvas.clientHeight || window.innerHeight),
  });
  const s0 = viewSize();
  renderer.setSize(s0.w, s0.h, false);

  const view = new UiView({ fonts, width: s0.w, height: s0.h, config, pixelRatio: dprOf() });
  const handles = buildDemoView(view);
  const overlay = createOverlay({ renderer, width: s0.w, height: s0.h, dpr: dprOf() }, { background: defaultThemeColors.bg });
  overlay.mount(view);

  const toInput = (type: UiInput['type'], e: PointerEvent): UiInput =>
    ({ type, x: e.clientX, y: e.clientY, t: performance.now() / 1000 });
  const send = (type: UiInput['type'], e: PointerEvent) => {
    const input = toInput(type, e);
    if (type !== 'move') handles.noteInput(`${type}(${Math.round(input.x)},${Math.round(input.y)})`);
    overlay.handleInput(input);
  };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); send('down', e); });
  canvas.addEventListener('pointermove', e => send('move', e));
  canvas.addEventListener('pointerup', e => send('up', e));
  canvas.addEventListener('pointercancel', e => send('cancel', e));

  window.addEventListener('resize', () => {
    const s = viewSize();
    renderer.setSize(s.w, s.h, false);
    overlay.resize(s.w, s.h, dprOf());
  });

  let last = performance.now();
  function loop(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    handles.frame(now / 1000);
    overlay.tick(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  (globalThis as Record<string, unknown>).__trUiDemo = { overlay, view, handles, config, renderer, version: 1 };
}
