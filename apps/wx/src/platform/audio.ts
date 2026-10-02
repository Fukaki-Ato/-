/**
 * AudioService 的微信小游戏实现：InnerAudioContext。
 * - 背景音乐：单实例惰性创建、跨曲复用（改 src 重播）；装配阶段不触碰 wx API，
 *   node:test 的 mock 无需预置音频面。
 * - 音效：每次一个实例，播放结束/出错即 destroy，防止实例泄漏。
 * - src：配置里的仓库相对路径 'assets/audio/...' 经 resolveWxAudioPath 映射到分包
 *   'pkg-assets/assets/audio/...'（tools/build-wx.mjs 复制落点）；已带分包前缀的路径与
 *   带协议的 URL（https 等）原样透传。失败经 onError 静默降级（音频是表现层增强，不阻塞玩法）。
 */
import type { AudioOptions, AudioService } from '@tr/framework/platform/platformAdapter.js';
import { PKG_ASSETS } from './subpackage.js';
import type { WxInnerAudioContext, WxLike } from './wxTypes.js';

const REPO_AUDIO_PREFIX = 'assets/audio/';

/** 仓库相对音频路径 → 代码包相对路径；远程 URL、已是分包路径、其它路径原样返回（不重复加前缀）。 */
export function resolveWxAudioPath(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const rel = url.replace(/^(\.?\/)+/, '');
  if (rel.startsWith(REPO_AUDIO_PREFIX)) return `${PKG_ASSETS}/${rel}`;
  return url;
}

/** 音量归一：缺省 1，非法值回缺省，越界夹到 [0,1]。 */
function clamp01(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

export function createWxAudio(wx: WxLike): AudioService {
  let music: WxInnerAudioContext | null = null;
  let musicUrl = '';
  const sfx = new Set<WxInnerAudioContext>();

  return {
    playMusic(rawUrl, options?: AudioOptions) {
      const url = resolveWxAudioPath(rawUrl);
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
      el.src = resolveWxAudioPath(url);
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
