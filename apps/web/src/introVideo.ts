/**
 * 角色登场视频的宿主侧注入（packages 零 DOM 禁令的另一半：apps 建 <video>，packages 只管摆）。
 * 套路照 uiShell 的背景视频：元素挂进 DOM 但挪出屏外（分离节点在部分浏览器会省掉解码，贴图就冻在首帧）、
 * 必须 muted（带音轨会被自动播放策略拦，登场音效另走 AudioService 的 sfx 通道）、playsInline、
 * 首帧等不到就放弃该角色（退化成只响音效，不阻塞进局）。
 * 视频路径来自 characters.json 的 intro.video，经 configResolve 拼部署 base（本地 dev 为 /，测试站为 /thunder-run/）。
 */
import * as THREE from 'three';
import { setIntroSource } from '@tr/game/render/introPanel.js';

const READY_TIMEOUT_MS = 4000;

function waitFirstFrame(v: HTMLVideoElement): Promise<void> {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('登场视频首帧超时')), READY_TIMEOUT_MS);
    v.onloadeddata = () => { clearTimeout(to); res(); };
    v.onerror = () => { clearTimeout(to); rej(new Error('登场视频加载失败')); };
  });
}

/** 为一个角色建视频面并注册进渲染层；任一步失败就静默跳过（该角色退化为无画面的登场音效）。 */
async function registerOne(charId: string, url: string): Promise<boolean> {
  const v = document.createElement('video');
  Object.assign(v.style, { position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', opacity: '0' });
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.loop = false;
  v.src = url;
  document.body.appendChild(v);
  try {
    await waitFirstFrame(v);
  } catch {
    v.remove();
    v.src = '';
    return false;
  }
  const texture = new THREE.VideoTexture(v);
  texture.colorSpace = THREE.SRGBColorSpace;
  setIntroSource(charId, {
    texture,
    play: () => new Promise<void>(res => {
      const done = (): void => { v.removeEventListener('ended', done); v.removeEventListener('error', done); res(); };
      v.addEventListener('ended', done);
      v.addEventListener('error', done);
      try {
        v.currentTime = 0; // 重开一局要重头播
      } catch { /* 未就绪时部分浏览器抛错，忽略 */ }
      void v.play().catch(done); // 策略拦截就直接交还渲染权，不让画面冻在原地
    }),
    stop: () => { if (!v.paused) v.pause(); },
  });
  return true;
}

/**
 * 读取 characters.json，把配了 intro.video 的角色全部预建好。须在首次进局前 await 完成。
 * 返回注入成功的角色数（取证与日志用）。
 */
export async function injectIntroVideos(
  fetchJson: (url: string) => Promise<unknown>, charactersUrl: string, baseUrl: string,
): Promise<number> {
  let items: unknown[] = [];
  try {
    const cfg = await fetchJson(charactersUrl) as { items?: unknown };
    items = Array.isArray(cfg?.items) ? cfg.items : [];
  } catch {
    return 0; // 配置没取到＝没有登场，不阻塞启动
  }
  const wanted = items.map(item => {
    const rec = (item ?? {}) as Record<string, unknown>;
    const intro = (rec['intro'] ?? {}) as Record<string, unknown>;
    return typeof rec['id'] === 'string' && typeof intro['video'] === 'string' && intro['video'] !== ''
      ? { charId: rec['id'], video: intro['video'] } : null;
  }).filter((x): x is { charId: string; video: string } => x !== null);
  const ok = await Promise.all(wanted.map(w => registerOne(w.charId, `${baseUrl}${w.video}`)));
  const n = ok.filter(Boolean).length;
  console.info(`[tr-web] 登场视频注入 ${n}/${wanted.length}`);
  return n;
}
