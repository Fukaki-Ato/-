/**
 * apps/web 自绘 UI 壳装配（S5）：DOM 侧只出现在这里——
 * 独立透明 UI canvas（盖在主画布上，z-index 合成）+ WebGLRenderer + 字体/配置加载 +
 * 原始 pointer 流注入（inputMode='raw'：拖拽滚动/按压完整，手势仍由 webPlatform 发业务事件）。
 * 说明：run 局内 runnerScene 自建 renderer 且不外露，故 web 端「两 pass 串接」= 浏览器合成器
 * 叠两块画布；wx 单画布共享 renderer 的 GL 级串接待 S7/S20（packages/render 增 renderer 注入口），
 * UiHost 侧接口不变（见会话汇报）。
 */
import * as THREE from 'three';
import { loadFontSet, resolveUiConfig, type UiConfig, type UiResources } from '@tr/framework/ui/index.js';
import { UiHost } from '@tr/framework/ui/host.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';

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

export interface UiShell {
  host: UiHost;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  config: UiConfig;
  destroy(): void;
}

export async function createUiShell(adapter: PlatformAdapter): Promise<UiShell> {
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    display: 'block', zIndex: '5', touchAction: 'none',
  });
  document.body.appendChild(canvas);

  const s0 = adapter.canvas.windowSize();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true }); // UI 层自带透明合成，AA 交 SDF
  renderer.setPixelRatio(s0.dpr);
  renderer.setSize(s0.width, s0.height, false);

  const [fonts, gameJson] = await Promise.all([
    loadFontSet(resources, `${import.meta.env.BASE_URL}assets/fonts`),
    resources.loadJson(`${import.meta.env.BASE_URL}game.json`),
  ]);
  const config = resolveUiConfig((gameJson as { params?: unknown }).params);

  const host = new UiHost({
    adapter,
    fonts,
    config,
    overlayHost: { renderer, width: s0.width, height: s0.height, dpr: s0.dpr },
    inputMode: 'raw',
    clearSurface: () => { renderer.setClearColor(0x000000, 0); renderer.clear(); },
    onViewportSize: s => { renderer.setPixelRatio(s.dpr); renderer.setSize(s.width, s.height, false); },
  });

  // 原始 pointer 流 → UiInput（CSS px 视口原点 = fixed inset:0 画布原点；t 秒）
  const toInput = (type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent) =>
    host.pushInput({ type, x: e.clientX, y: e.clientY, t: performance.now() / 1000 });
  const onDown = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); toInput('down', e); };
  const onMove = (e: PointerEvent) => toInput('move', e);
  const onUp = (e: PointerEvent) => toInput('up', e);
  const onCancel = (e: PointerEvent) => toInput('cancel', e);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  return {
    host, renderer, canvas, config,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      host.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
