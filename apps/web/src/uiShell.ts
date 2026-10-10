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
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
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
  fonts: FontSet;
  badges: BadgeSet;
  /** 主界面背景（Web＝循环视频，取不到时回落静态图；缺省时回主题纯色底） */
  backdrop?: BackdropSet;
  /** 背景视频只在大厅解码：进大厅播、离开就停（跑一局看不见还解码，白烧 GPU 和电） */
  setBackgroundVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * 背景循环视频（素材处理 tools 侧 ffmpeg，源片在仓库外）：裁掉底部 50px 的
 * 「豆包AI生成 / Qoder AI 生成」双行水印再等比拉回 720×1280、去音轨（带音轨会被
 * 自动播放策略拦）、setsar=1（否则浏览器报的 videoWidth 不是 720、cover 算出的宽对不上）、
 * baseline profile + faststart，15.07s / 3.0MB。
 * 视频元素必须待在壳层（packages/** 禁 DOM）；框架侧照旧只收 NinePatchSource。
 * flipY 关掉：three 对 <video> 上传吃 UNPACK_FLIP_Y，而 menuBackdrop 的 UV 已按
 * 「行 0＝图顶」的 ImageBitmap 约定翻了 repeat.y，两处都翻等于不翻 ⇒ 画面上下颠倒。
 */
async function loadVideoBackground(base: string): Promise<
  { src: NinePatchSource; cover: NinePatchSource | undefined; el: HTMLVideoElement; setVisible(visible: boolean): void } | undefined> {
  const v = document.createElement('video');
  // 挂进 DOM 但不可见：分离节点在部分浏览器会省掉解码，贴图就冻在首帧
  Object.assign(v.style, { position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', opacity: '0' });
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = `${base}assets/ui/menu-bg.mp4`;
  document.body.appendChild(v);
  try {
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error('背景视频首帧超时')), 4000);
      v.onloadeddata = () => { clearTimeout(to); res(); };
      v.onerror = () => { clearTimeout(to); rej(new Error('背景视频加载失败')); };
    });
  } catch {
    v.remove();
    v.src = '';
    return undefined;
  }
  const texture = new THREE.VideoTexture(v);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  // 起点帧：循环接缝淡入淡出的覆盖图（视频首帧的静帧，见 menuBackdrop.loopFade）
  let cover: NinePatchSource | undefined;
  try {
    const bmp = await resources.loadImage(`${base}assets/ui/menu-bg-loop.jpg`) as ImageBitmap;
    const t = new THREE.Texture(bmp);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    cover = { texture: t, insets: { top: 0, right: 0, bottom: 0, left: 0 }, texSize: { w: bmp.width, h: bmp.height } };
  } catch { /* 没起点帧就退回硬切，不影响启动 */ }
  return {
    el: v,
    cover,
    setVisible: (visible: boolean): void => {
      if (!visible) v.pause();
      else void v.play().catch(() => undefined);
    },
    src: {
      texture, insets: { top: 0, right: 0, bottom: 0, left: 0 },
      texSize: { w: v.videoWidth || 720, h: v.videoHeight || 1280 },
    },
  };
}

async function loadBackdrop(base: string): Promise<{ set: BackdropSet; video?: { el: HTMLVideoElement; setVisible(visible: boolean): void } } | undefined> {
  const still = await loadStill(`${base}assets/ui/menu-bg.png`);
  const vid = await loadVideoBackground(base);
  if (vid) {
    return {
      set: {
        main: vid.src,
        seconds: Number.isFinite(vid.el.duration) && vid.el.duration > 0 ? vid.el.duration : 15.07,
        loopCover: vid.cover,
        time: () => vid.el.currentTime,
      },
      video: { el: vid.el, setVisible: vid.setVisible },
    };
  }
  return still ? { set: { main: still } } : undefined;
}

async function loadStill(url: string): Promise<NinePatchSource | undefined> {
  try {
    const bmp = await resources.loadImage(url) as ImageBitmap;
    const texture = new THREE.Texture(bmp);
    // 背景走 three 标准材质（非 UI 直通 shader），必须标 sRGB 否则被当线性色洗白
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return { texture, insets: { top: 0, right: 0, bottom: 0, left: 0 }, texSize: { w: bmp.width, h: bmp.height } };
  } catch { return undefined; }
}

export async function createUiShell(adapter: PlatformAdapter): Promise<UiShell> {
  const canvas = document.createElement('canvas');
  canvas.className = 'tr-ui-canvas';
  canvas.tabIndex = -1;
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

  const bg = await loadBackdrop(import.meta.env.BASE_URL);
  const backdrop = bg?.set;
  const bgVideo = bg?.video;

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
    host, renderer, canvas, config, fonts, badges, backdrop,
    // 静态图兜底时 bgVideo 是 undefined ⇒ 空操作，调用方不用区分
    setBackgroundVisible: (visible: boolean) => { bgVideo?.setVisible(visible); },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      for (const src of [...Object.values(badges.normal), ...Object.values(badges.glow)]) src.texture?.dispose();
      bgVideo?.el.pause();          // 背景视频是壳层建的 DOM 节点，销毁归这里收
      bgVideo?.el.remove();
      backdrop?.loopCover?.texture?.dispose();
      backdrop?.main.texture?.dispose();
      host.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
