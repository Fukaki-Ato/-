/**
 * AudioService 的网页实现：HTMLAudioElement。
 * - 背景音乐：单个 audio 元素复用；同曲在播=幂等（只同步音量/循环位），切曲=改 src 重播。
 * - 音效：每次 new Audio 即发即忘（无池化需求前不提前优化）。
 * - 失败静默（契约要求不抛错）：play() 被自动播放策略拒绝、404、解码失败都只是没声音，
 *   正常玩法路径的首次声源发生在「点击开始」之后，不会被策略拦截。
 */
import type { AudioOptions, AudioService } from '@tr/framework/platform/platformAdapter.js';

/** 音量归一：缺省 1，非法值回缺省，越界夹到 [0,1]。 */
function clamp01(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

export function createWebAudio(): AudioService {
  let music: HTMLAudioElement | null = null;
  let musicUrl = '';

  const fire = (el: HTMLAudioElement) => { void el.play().catch(() => { /* 策略/解码失败：静默降级 */ }); };

  return {
    playMusic(url, options?: AudioOptions) {
      const volume = clamp01(options?.volume);
      const loop = options?.loop ?? false;
      if (music && musicUrl === url) {
        music.volume = volume;
        music.loop = loop;
        if (music.paused) fire(music);
        return;
      }
      music?.pause();
      music = new Audio(url);
      musicUrl = url;
      music.volume = volume;
      music.loop = loop;
      fire(music);
    },
    stopMusic() {
      if (!music) return;
      music.pause();
      try {
        music.currentTime = 0; // 未加载完成时部分浏览器会抛错，忽略
      } catch {
        /* 静默 */
      }
    },
    playSfx(url, options?: AudioOptions) {
      const el = new Audio(url);
      el.volume = clamp01(options?.volume);
      el.loop = options?.loop ?? false;
      fire(el);
    },
    dispose() {
      music?.pause();
      music = null;
      musicUrl = '';
    },
  };
}
