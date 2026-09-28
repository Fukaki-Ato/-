/**
 * AudioService 的微信小游戏实现：InnerAudioContext。
 * - 背景音乐：单实例惰性创建、跨曲复用（改 src 重播）；装配阶段不触碰 wx API，
 *   node:test 的 mock 无需预置音频面。
 * - 音效：每次一个实例，播放结束/出错即 destroy，防止实例泄漏。
 * - src：包内相对路径（'assets/audio/...'）或 https URL；失败经 onError 静默降级
 *   （音频是表现层增强，不阻塞玩法）。
 */
import type { AudioOptions, AudioService } from '@tr/framework/platform/platformAdapter.js';
import type { WxInnerAudioContext, WxLike } from './wxTypes.js';

/** 音量归一：缺省 1，非法值回缺省，越界夹到 [0,1]。 */
function clamp01(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

export function createWxAudio(wx: WxLike): AudioService {
  let music: WxInnerAudioContext | null = null;
  let musicUrl = '';
  const sfx = new Set<WxInnerAudioContext>();

  return {
    playMusic(url, options?: AudioOptions) {
      if (!music) {
        music = wx.createInnerAudioContext();
        music.onError(() => { /* 静默降级 */ });
      }
      if (musicUrl !== url) {
        music.stop();
        music.src = url;
        musicUrl = url;
      }
      music.loop = options?.loop ?? false;
      music.volume = clamp01(options?.volume);
      music.play();
    },
    stopMusic() {
      if (music && musicUrl !== '') music.stop();
    },
    playSfx(url, options?: AudioOptions) {
      const el = wx.createInnerAudioContext();
      sfx.add(el);
      const drop = () => {
        el.destroy();
        sfx.delete(el);
      };
      el.loop = options?.loop ?? false;
      el.volume = clamp01(options?.volume);
      el.onEnded(drop);
      el.onError(drop);
      el.src = url;
      el.play();
    },
    dispose() {
      music?.destroy();
      music = null;
      musicUrl = '';
      for (const el of sfx) el.destroy();
      sfx.clear();
    },
  };
}
