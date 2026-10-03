/**
 * 网页端平台适配实现（PlatformAdapter v2 的 web 实现，映射表见 docs/platform-adapter-v2.md §4）。
 * 这是全项目唯一允许直接接触 DOM/BOM API 的输入/存储出口（UI 层除外）。
 * DOM 知识收敛在本包：挂载点经构造参数注入（契约 D2 / §7.1），bootstrap 侧不再出现 document。
 */
import { createGestureClassifier } from '@tr/framework/platform/gestureClassifier.js';
import type {
  CanvasFactory, GLCanvas, InputEvent, PlatformAdapter, SyncStorage, Unsubscribe, WindowSize,
} from '@tr/framework/platform/platformAdapter.js';
import { createWebAudio } from './webAudio.js';
import { createWebExtras } from './webExtras.js';

export interface WebPlatformOptions {
  /** 主画布挂载点（apps/web 入口查 #screen 后注入；contract §7.1） */
  mount: HTMLElement;
}

/** HTMLCanvasElement → GLCanvas 的绑定转换（结构化兼容，实现包内部一次性断言）。 */
function toGLCanvas(el: HTMLCanvasElement): GLCanvas {
  return el as unknown as GLCanvas;
}

export function createWebPlatform(options: WebPlatformOptions): PlatformAdapter {
  const mount = options.mount;

  // ---------- §1 画布：主画布幂等单例（D1），显式离屏工厂 ----------
  let mainEl: HTMLCanvasElement | null = null;
  const windowSize = (): WindowSize => {
    const rect = mount.getBoundingClientRect();
    return {
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
      dpr: Math.min(window.devicePixelRatio || 1, 2), // v1 上限策略原样保留
    };
  };
  const resizeSubs = new Set<(s: WindowSize) => void>();
  let lastSize = windowSize();
  let resizePending = 0;
  const fireResize = () => {
    if (resizePending) return; // rAF 去抖（转屏连发只回调一次）
    resizePending = requestAnimationFrame(() => {
      resizePending = 0;
      const s = windowSize();
      if (s.width === lastSize.width && s.height === lastSize.height && s.dpr === lastSize.dpr) return;
      lastSize = s;
      for (const cb of [...resizeSubs]) cb(s);
    });
  };
  window.addEventListener('resize', fireResize);
  window.addEventListener('orientationchange', fireResize);

  const canvas: CanvasFactory = {
    mainCanvas() {
      if (!mainEl) {
        mainEl = document.createElement('canvas');
        mainEl.style.width = '100%';
        mainEl.style.height = '100%';
        mainEl.style.display = 'block';
        // 触屏：画布独占手势（滑动只喂游戏，不滚动页面/触发下拉刷新）；仅作用于 canvas，登录页按钮与输入框不受影响
        mainEl.style.touchAction = 'none';
      }
      // 页面流转会让 DOM screens replaceChildren 掉画布；重新进 run 时挂回（v1 同语义）
      if (mainEl.parentElement !== mount) mount.replaceChildren(mainEl);
      return toGLCanvas(mainEl);
    },
    createOffscreenCanvas(width, height) {
      const el = document.createElement('canvas');
      el.width = Math.max(1, Math.floor(width));
      el.height = Math.max(1, Math.floor(height));
      return toGLCanvas(el);
    },
    windowSize,
    onResize(cb) {
      resizeSubs.add(cb);
      return () => { resizeSubs.delete(cb); };
    },
  };

  // ---------- §2 输入：window 级事件，随时可订阅（D5，v1「先建画布否则 throw」废止） ----------
  // v2 语义：keydown 过滤 e.repeat（按住不连发 down，避免落地自动连跳 / E 连放技能）；keyup 不滤，按住→松开必达。
  const classifier = createGestureClassifier();
  const inputSubs = new Set<(e: InputEvent) => void>();
  const emit = (e: InputEvent | null) => {
    if (!e) return;
    for (const cb of [...inputSubs]) cb(e);
  };
  const onPointerDown = (e: PointerEvent) =>
    emit(classifier.push({ phase: 'down', x: e.clientX, y: e.clientY, timeMs: performance.now() }));
  const onPointerUp = (e: PointerEvent) =>
    emit(classifier.push({ phase: 'up', x: e.clientX, y: e.clientY, timeMs: performance.now() }));
  // 输入框聚焦时不拦截按键（S5 前登录页表单可正常打字；S5 后随 screens.ts 退役）
  const inFormField = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.tagName === 'INPUT';
  const onKeyDown = (e: KeyboardEvent) => {
    if (inFormField(e)) return; // INPUT 聚焦绕过保留（登录页可正常打字）
    if (e.repeat) return;       // v2：系统按键 repeat 不派发 down（首次按下照常）
    emit({ type: 'key', code: e.code, phase: 'down' });
  };
  const onKeyUp = (e: KeyboardEvent) => { if (!inFormField(e)) emit({ type: 'key', code: e.code, phase: 'up' }); };
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ---------- §3 六个旧成员：签名与实现语义同 v1 逐字平移（D6） ----------
  const storage: SyncStorage = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 无痕模式等场景静默失败 */ } },
    remove: k => { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
  };

  const fetchJson = async (url: string): Promise<unknown> => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  };

  return {
    version: 2,
    env: 'web',
    canvas,

    onInput(cb): Unsubscribe {
      inputSubs.add(cb);
      return () => { inputSubs.delete(cb); };
    },

    storage,

    fetchJson,

    requestFrame: cb => requestAnimationFrame(cb), // rAF 时间戳与 performance.now 同基准（D12 天然满足）
    cancelFrame: h => cancelAnimationFrame(h),

    onVisibility(cb) {
      const handler = () => cb(document.hidden);
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },

    now: () => performance.now(),

    extras: createWebExtras({ storage, fetchJson }),
    audio: createWebAudio(),
  };
}
