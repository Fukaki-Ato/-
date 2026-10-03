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
  /** 大厅背景贴图：优先循环视频 assets/ui/lobby-bg.mp4，取不到时回落静态 lobby-bg.jpg（都按 cover 铺满） */
  background?: NinePatchSource;
  /** 只有大厅在放背景视频：进大厅播、离开就停（跑一局时看不见还解码，白烧 GPU 和电） */
  setBackgroundVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * 大厅背景循环视频。视频元素只能待在壳层（packages/** 禁 DOM），框架侧照旧只收一个
 * NinePatchSource —— 贴图换成 THREE.VideoTexture 而已，three 0.160 的 VideoTexture
 * 自带 requestVideoFrameCallback，逐帧刷新不用壳层插手。
 * 素材处理（tools 侧 ffmpeg，源片在仓库外）：裁掉底部 44px 的「豆包AI生成 / Qoder AI 生成」
 * 水印再等比拉回 720×1280、去音轨、setsar=1，15.04s / 2.3MB。
 * 首帧超时或解码不支持 → 返回 undefined，由调用方回落静态图，页面绝不空底。
 */
async function loadVideoBackground(base: string): Promise<
  { src: NinePatchSource; el: HTMLVideoElement; setVisible(visible: boolean): void } | undefined> {
  const v = document.createElement('video');
  // 挂进 DOM 但不可见：分离节点在部分浏览器会省掉解码，背景图就冻在首帧
  Object.assign(v.style, { position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', opacity: '0' });
  v.loop = true;
  v.muted = true; // 带音轨的自动播放会被浏览器拦，背景音也归 audioDirector 管
  v.playsInline = true;
  v.preload = 'auto';
  v.src = `${base}assets/ui/lobby-bg.mp4`;
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
  // 不在这里播：由壳层的 setBackgroundVisible 管（进大厅才播）。muted + playsInline 已经满足
  // 浏览器的自动播放条件，不需要等用户手势；play() 万一被策略拒绝，首帧仍是贴图，不至于黑底。
  const texture = new THREE.VideoTexture(v);
  // 必须关掉 flipY：UI 那套自定义 shader 的 UV 与 ImageBitmap 路径对齐（Chrome 对 ImageBitmap
  // 不吃 UNPACK_FLIP_Y），而 <video> 上传是吃 flipY 的，留着 true 会把背景整个上下颠倒。
  texture.flipY = false;
  texture.needsUpdate = true;
  return {
    el: v,
    setVisible: (visible: boolean): void => {
      if (!visible) v.pause();
      else void v.play().catch(() => undefined);
    },
    src: {
      texture, insets: { top: 0, right: 0, bottom: 0, left: 0 },
      texSize: { w: v.videoWidth || 720, h: v.videoHeight || 1280 }, fit: 'cover',
    },
  };
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

  // 大厅背景：循环视频优先，拿不到再回静态图（两者都等比铺满、超出居中裁掉，横窗下不变形）
  let background: NinePatchSource | undefined;
  let bgVideo: HTMLVideoElement | undefined;
  let bgSetVisible: ((visible: boolean) => void) | undefined;
  const vid = await loadVideoBackground(import.meta.env.BASE_URL);
  if (vid) {
    background = vid.src;
    bgVideo = vid.el;
    bgSetVisible = vid.setVisible;
  } else {
    try {
      const bmp = await resources.loadImage(`${import.meta.env.BASE_URL}assets/ui/lobby-bg.jpg`);
      const texture = new THREE.Texture(bmp as unknown as ImageBitmap);
      texture.needsUpdate = true;
      background = {
        texture, insets: { top: 0, right: 0, bottom: 0, left: 0 },
        texSize: { w: bmp.width, h: bmp.height }, fit: 'cover',
      };
    } catch { /* 视频和图都没有：回主题纯色底，不阻塞启动 */ }
  }

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
    host, renderer, canvas, config, badges, background,
    // 静态图兜底时 bgSetVisible 是 undefined ⇒ 空操作，调用方不用区分
    setBackgroundVisible: (visible: boolean) => { bgSetVisible?.(visible); },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      for (const src of [...Object.values(badges.normal), ...Object.values(badges.glow)]) src.texture?.dispose();
      bgVideo?.pause(); // 背景视频是壳层建的 DOM 节点，销毁时归这里收
      bgVideo?.remove();
      background?.texture.dispose();
      host.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
