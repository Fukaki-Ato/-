/**
 * AudioService —— 跨端音频能力（平台适配层 v2 可选扩展）。
 * 与 extras 的区别：extras 是 wx 专属能力及 web 兜底；audio 是两端都要实现的通用宿主能力，
 * 挂在 PlatformAdapter.audio（可选——纯逻辑测试壳可缺省，业务代码须容忍 undefined）。
 * 约定：
 * - URL 语义由宿主解释：web 为站点根相对路径（'assets/audio/...'），wx 为包内相对路径；
 *   framework 不解析、不拼接资源路径；
 * - 本接口不感知任何游戏内容规则（播什么、何时播由 packages/game 决定）；
 * - 所有方法必须不抛错：拿不到声源（404/自动播放策略拦截/解码失败）时静默降级。
 */

export interface AudioOptions {
  /** 音量 0..1（宿主实现内部 clamp）；缺省 1。 */
  volume?: number;
  /** 循环播放（背景音乐用）；缺省 false。 */
  loop?: boolean;
}

export interface AudioService {
  /** 播放循环背景音乐；同一 url 重复调用幂等（不打断已在播放的同一曲目，仅同步音量/循环位）。 */
  playMusic(url: string, options?: AudioOptions): void;
  /** 停止背景音乐并复位（未在播放时为空操作）。 */
  stopMusic(): void;
  /** 播放一次性音效（可与音乐、其它音效叠加）。 */
  playSfx(url: string, options?: AudioOptions): void;
  /** 释放底层资源；之后仍可继续调用播放方法（实现应惰性重建）。 */
  dispose(): void;
}
