import type {
  IAdService,
  ICloudService,
  ILogger,
  IPlatformAdapter,
  IStorage,
  LoginResult,
  PayProduct,
  PayResult,
  ShareOptions,
  UserKV,
} from '../contracts';
import { createSafeStorage } from '../framework/Storage';
import { LocalCloudService, type LocalCloudIdentity } from './LocalCloudService';
import { MockAdService, type MockAdOptions } from './MockAdService';

export const LOCAL_UID_KEY = 'ltkp.local.uid';
const LOCAL_NICKNAME = '酷跑玩家';

export interface LocalPlatformOptions {
  /** 存储实现，默认 createSafeStorage()；测试可注入共享的 MemoryStorage。 */
  storage?: IStorage;
  log?: ILogger;
  ad?: IAdService;
  adOptions?: MockAdOptions;
  cloud?: ICloudService;
}

export class LocalPlatformAdapter implements IPlatformAdapter {
  readonly kind = 'local' as const;
  readonly storage: IStorage;
  readonly ad: IAdService;
  readonly cloud: ICloudService;

  private readonly log?: ILogger;
  private me: LocalCloudIdentity | null = null;

  constructor(opts: LocalPlatformOptions = {}) {
    this.log = opts.log;
    this.storage = opts.storage ?? createSafeStorage(opts.log);
    this.ad = opts.ad ?? new MockAdService(opts.adOptions);
    this.cloud = opts.cloud ?? new LocalCloudService({
      storage: this.storage,
      log: opts.log,
      getIdentity: () => this.identity(),
    });
  }

  async init(): Promise<void> {
    // 本地模式无需初始化
  }

  async login(): Promise<LoginResult> {
    let uid = this.storage.get(LOCAL_UID_KEY);
    if (!uid || !/^guest_[a-z0-9]{8}$/.test(uid)) {
      uid = `guest_${randomToken(8)}`;
      this.storage.set(LOCAL_UID_KEY, uid);
    }
    this.me = { uid, nickname: LOCAL_NICKNAME, avatarUrl: '' };
    this.log?.info(`本地登录成功：${uid}`);
    return { ...this.me, isGuest: true };
  }

  async share(opts: ShareOptions): Promise<boolean> {
    this.log?.info('本地分享（模拟成功）', opts);
    return true;
  }

  async pay(product: PayProduct): Promise<PayResult> {
    this.log?.warn('本地模式不支持支付', product);
    return { ok: false, reason: 'unsupported' };
  }

  setUserCloudStorage(kv: UserKV[]): void {
    this.log?.info('setUserCloudStorage（本地模拟）', kv);
  }

  vibrate(type: 'short' | 'long'): void {
    this.log?.debug(`vibrate（本地模拟）：${type}`);
  }

  copyText(text: string): void {
    this.log?.info(`copyText（本地模拟）：${text}`);
  }

  private identity(): LocalCloudIdentity {
    return this.me ?? {
      uid: this.storage.get(LOCAL_UID_KEY) ?? 'guest_local',
      nickname: LOCAL_NICKNAME,
      avatarUrl: '',
    };
  }
}

function randomToken(length: number): string {
  let token = '';
  while (token.length < length) token += Math.random().toString(36).slice(2);
  return token.slice(0, length);
}
