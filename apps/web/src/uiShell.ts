/**
 * apps/web 自绘 UI 壳装配（S5）：DOM 侧只出现在这里——
 * 独立透明 UI canvas（盖在主画布上，z-index 合成）+ WebGLRenderer + 字体/配置加载 +
 * 原始 pointer 流注入（inputMode='raw'：拖拽滚动/按压完整，手势仍由 webPlatform 发业务事件）。
 * 说明：run 局内 runnerScene 自建 renderer 且不外露，故 web 端「两 pass 串接」= 浏览器合成器
 * 叠两块画布；wx 单画布共享 renderer 的 GL 级串接待 S7/S20（packages/render 增 renderer 注入口），
 * UiHost 侧接口不变（见会话汇报）。
 */
import * as THREE from 'three';
import { loadFontSet, resolveUiConfig, type NinePatchSource, type UiConfig, type UiResources } from '@tr/framework/ui/index.js';
import { UiHost } from '@tr/framework/ui/host.js';
import { BADGE_NAMES, type BadgeSet } from '@tr/game/ui/badges.js';
import type { BackdropSet } from '@tr/game/ui/menuBackdrop.js';
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
  badges: BadgeSet;
  /** 主界面背景贴图（assets/ui/menu-bg.png，合成效果图抹 UI 补出的纯背景；cover 铺满） */
  background?: NinePatchSource;
  /** 分层背景动效贴图（云条/海鸥/浪花带；缺省时动效层不挂） */
  backdrop?: BackdropSet;
  destroy(): void;
}

async function loadBackdrop(base: string): Promise<BackdropSet | undefined> {
  const one = async (name: string): Promise<NinePatchSource | undefined> => {
    try {
      const bmp = await resources.loadImage(`${base}assets/ui/backdrop/${name}.png`) as ImageBitmap;
      const texture = new THREE.Texture(bmp);
      texture.needsUpdate = true;
      return { texture, insets: { top: 0, right: 0, bottom: 0, left: 0 }, texSize: { w: bmp.width, h: bmp.height } };
    } catch { return undefined; }
  };
  const [cloudA, cloudB, foam, ga, gb, gc] = await Promise.all(
    ['cloud_a_strip', 'cloud_b_strip', 'foam_strip', 'gull_a', 'gull_b', 'gull_c'].map(one),
  );
  const gulls = [ga, gb, gc].filter((g): g is NinePatchSource => g !== undefined);
  if (!cloudA || !cloudB || !foam || gulls.length === 0) return undefined;
  return { cloudA, cloudB, foam, gulls };
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

  // 大厅徽标：normal + glow 两帧；零 insets 九宫格 = 整图拉伸；缺文件降级为空槽，不阻塞启动
  const badges: BadgeSet = { normal: {}, glow: {} };
  await Promise.all(BADGE_NAMES.flatMap(n => (['normal', 'glow'] as const).map(async sub => {
    try {
      const bmp = await resources.loadImage(`${import.meta.env.BASE_URL}assets/ui/badges/${sub}/${n}.png`);
      // ImageLike 是框架跨端抽象；web 侧实为 ImageBitmap（uiShell 允许 DOM 类型）
      const texture = new THREE.Texture(bmp as unknown as ImageBitmap);
      texture.needsUpdate = true;
      badges[sub][n] = { texture, insets: { top: 0, right: 0, bottom: 0, left: 0 }, texSize: { w: bmp.width, h: bmp.height } };
    } catch { /* 单帧缺失不阻塞页面 */ }
  })));

  // 主界面背景：合成效果图抹 UI 补出的纯背景，等比铺满、超出居中裁掉（横窗下不变形）
  let background: NinePatchSource | undefined;
  try {
    const bmp = await resources.loadImage(`${import.meta.env.BASE_URL}assets/ui/menu-bg.png`) as ImageBitmap;
    const texture = new THREE.Texture(bmp);
    texture.needsUpdate = true;
    background = {
      texture, insets: { top: 0, right: 0, bottom: 0, left: 0 },
      texSize: { w: bmp.width, h: bmp.height }, fit: 'cover',
    };
  } catch { /* 缺图回主题纯色底，不阻塞启动 */ }
  const backdrop = await loadBackdrop(import.meta.env.BASE_URL);

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
    host, renderer, canvas, config, badges, background, backdrop,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      for (const src of [...Object.values(badges.normal), ...Object.values(badges.glow)]) src.texture?.dispose();
      background?.texture.dispose();
      for (const g of backdrop?.gulls ?? []) g.texture?.dispose();
      backdrop?.cloudA.texture?.dispose();
      backdrop?.cloudB.texture?.dispose();
      backdrop?.foam.texture?.dispose();
      host.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
