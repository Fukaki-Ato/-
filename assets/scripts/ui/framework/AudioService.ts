import { AudioSource, director, isValid, Node } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { loadAudio } from './Assets';
import { UIRoot } from './UIRoot';

const log = new Logger();

/**
 * BGM/SFX 播放服务（docs/04 §1/§2）。
 * 开关状态存档在 ctx.save.settings（写后 markDirty）；资源缺失静默，仅 Assets 层 warn 一次。
 */
export class AudioService {
  private static _instance: AudioService | null = null;

  static init(ctx?: IGameContext, parent?: Node): AudioService {
    if (!AudioService._instance) {
      AudioService._instance = new AudioService(ctx, parent);
    } else if (ctx) {
      AudioService._instance.ctx = ctx;
    }
    return AudioService._instance;
  }

  static get instance(): AudioService | null {
    return AudioService._instance;
  }

  static playBgm(path: string): void {
    AudioService.ensureInstance().playBgm(path);
  }

  static stopBgm(): void {
    AudioService._instance?.stopBgm();
  }

  static playSfx(path: string): void {
    AudioService.ensureInstance().playSfx(path);
  }

  static setMusic(on: boolean): void {
    AudioService.ensureInstance().setMusic(on);
  }

  static setSfx(on: boolean): void {
    AudioService.ensureInstance().setSfx(on);
  }

  static isMusicOn(): boolean {
    return AudioService._instance?.musicOn ?? true;
  }

  static isSfxOn(): boolean {
    return AudioService._instance?.sfxOn ?? true;
  }

  static destroy(): void {
    AudioService._instance?.dispose();
    AudioService._instance = null;
  }

  private static ensureInstance(): AudioService {
    return AudioService._instance ?? AudioService.init();
  }

  private ctx: IGameContext | null;
  private host: Node | null = null;
  private bgmSource: AudioSource | null = null;
  private sfxSource: AudioSource | null = null;
  private currentBgm = '';
  private localMusic = true;
  private localSfx = true;
  private warnedHost = false;

  private constructor(ctx?: IGameContext, parent?: Node) {
    this.ctx = ctx ?? null;
    if (this.ctx) {
      this.localMusic = this.ctx.save.settings.music !== false;
      this.localSfx = this.ctx.save.settings.sfx !== false;
    }
    this.attach(parent);
  }

  get musicOn(): boolean {
    return this.ctx ? this.ctx.save.settings.music !== false : this.localMusic;
  }

  get sfxOn(): boolean {
    return this.ctx ? this.ctx.save.settings.sfx !== false : this.localSfx;
  }

  playBgm(path: string): void {
    this.currentBgm = path;
    if (!this.musicOn || !path) return;
    this.ensureSources();
    const source = this.bgmSource;
    if (!source) return;
    loadAudio(path, (clip) => {
      // 异步加载期间可能已切歌，丢弃过期回调。
      if (!clip || path !== this.currentBgm || !isValid(source.node) || !this.musicOn) return;
      if (source.clip === clip && source.playing) return;
      source.stop();
      source.clip = clip;
      source.play();
    });
  }

  stopBgm(): void {
    this.bgmSource?.stop();
  }

  playSfx(path: string): void {
    if (!this.sfxOn || !path) return;
    this.ensureSources();
    const source = this.sfxSource;
    if (!source) return;
    loadAudio(path, (clip) => {
      if (!clip || !isValid(source.node) || !this.sfxOn) return;
      source.playOneShot(clip, 0.9);
    });
  }

  setMusic(on: boolean): void {
    if (this.ctx) {
      this.ctx.save.settings.music = on;
      this.ctx.markDirty();
    } else {
      this.localMusic = on;
    }
    if (on) this.playBgm(this.currentBgm);
    else this.stopBgm();
  }

  setSfx(on: boolean): void {
    if (this.ctx) {
      this.ctx.save.settings.sfx = on;
      this.ctx.markDirty();
    } else {
      this.localSfx = on;
    }
  }

  dispose(): void {
    this.bgmSource?.stop();
    if (this.host && isValid(this.host)) this.host.destroy();
    this.host = null;
    this.bgmSource = null;
    this.sfxSource = null;
  }

  private attach(parent?: Node): void {
    this.ensureHost(parent);
  }

  private ensureHost(parent?: Node): void {
    if (this.host && isValid(this.host)) return;
    const scene = director.getScene();
    const target = parent ?? UIRoot.instance?.root ?? scene;
    if (!target) {
      if (!this.warnedHost) {
        this.warnedHost = true;
        log.warn('AudioService 初始化时场景不可用，音频功能暂不可用');
      }
      return;
    }
    const host = new Node('AudioService');
    target.addChild(host);
    this.host = host;
    const bgmNode = new Node('bgm');
    host.addChild(bgmNode);
    const bgm = bgmNode.addComponent(AudioSource);
    bgm.playOnAwake = false;
    bgm.loop = true;
    bgm.volume = 0.6;
    const sfxNode = new Node('sfx');
    host.addChild(sfxNode);
    const sfx = sfxNode.addComponent(AudioSource);
    sfx.playOnAwake = false;
    sfx.volume = 1;
    this.bgmSource = bgm;
    this.sfxSource = sfx;
  }

  private ensureSources(): void {
    if (!this.host || !isValid(this.host) || !this.bgmSource || !this.sfxSource) {
      this.ensureHost();
    }
  }
}
