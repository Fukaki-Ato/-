import { describe, expect, it } from 'vitest';
import type {
  ICloudService,
  LeaderboardQuery,
  LeaderboardResult,
  SaveData,
  SubmitScorePayload,
  SubmitScoreResult,
} from '../../assets/scripts/core/contracts';
import { WechatPlatformAdapter, WECHAT_GUEST_UID_KEY } from '../../assets/scripts/ui/platform/wechat/WechatPlatformAdapter';
import type { WechatCloudLoginProfile } from '../../assets/scripts/ui/platform/wechat/WechatCloudService';
import type { WxApi, WxMidasPaymentOptions } from '../../assets/scripts/ui/platform/wechat/WechatTypes';
import { silentLog } from '../helpers';

interface FakeWxState {
  storage: Map<string, string>;
  shareMenus: Array<{ withShareTicket?: boolean }>;
  shares: Array<{ title?: string; imageUrl?: string; query?: string }>;
  clipboard: string[];
  vibes: string[];
  kv: Array<{ key: string; value: string }> | null;
  keepScreenOn: number;
  fireShow: () => void;
  fireHide: () => void;
  privacy: { supported: boolean; need: boolean; authorizeOk: boolean; queries: number; requests: number };
  platform: string;
  midas: WxMidasPaymentOptions[];
  midasMode: 'success' | 'cancel' | 'fail';
}

function createFakeWx(): { wx: WxApi; state: FakeWxState } {
  const state: FakeWxState = {
    storage: new Map(),
    shareMenus: [],
    shares: [],
    clipboard: [],
    vibes: [],
    kv: null,
    keepScreenOn: 0,
    fireShow: () => undefined,
    fireHide: () => undefined,
    privacy: { supported: true, need: true, authorizeOk: true, queries: 0, requests: 0 },
    platform: 'android',
    midas: [],
    midasMode: 'success',
  };
  const wx: WxApi = {
    getStorageSync: (key) => state.storage.get(key) ?? '',
    setStorageSync: (key, value) => {
      state.storage.set(key, String(value));
    },
    removeStorageSync: (key) => {
      state.storage.delete(key);
    },
    showShareMenu: (opts) => {
      state.shareMenus.push(opts ?? {});
    },
    onShareAppMessage: () => undefined,
    shareAppMessage: (opts) => {
      state.shares.push(opts);
    },
    onShow: (cb) => {
      state.fireShow = () => cb();
    },
    onHide: (cb) => {
      state.fireHide = () => cb();
    },
    setKeepScreenOn: () => {
      state.keepScreenOn += 1;
    },
    vibrateShort: (opts) => {
      state.vibes.push(opts?.type ?? 'short');
    },
    vibrateLong: () => {
      state.vibes.push('long');
    },
    setClipboardData: (opts) => {
      state.clipboard.push(opts.data);
    },
    setUserCloudStorage: (opts) => {
      state.kv = opts.KVDataList;
    },
    requestMidasPayment: (opts) => {
      state.midas.push(opts);
      if (state.midasMode === 'success') opts.success?.();
      else if (state.midasMode === 'cancel') opts.fail?.({ errMsg: 'requestMidasPayment:fail cancel' });
      else opts.fail?.({ errMsg: 'requestMidasPayment:fail internal error' });
    },
    getDeviceInfo: () => ({ platform: state.platform }),
    getPrivacySetting: (opts) => {
      if (!state.privacy.supported) return;
      state.privacy.queries += 1;
      opts.success?.({ needAuthorization: state.privacy.need });
    },
    requirePrivacyAuthorize: (opts) => {
      state.privacy.requests += 1;
      if (state.privacy.authorizeOk) opts.success?.();
      else opts.fail?.({ errMsg: 'requirePrivacyAuthorize:fail user deny' });
    },
  };
  return { wx, state };
}

class FakeCloud implements ICloudService {
  init(_envId: string): Promise<void> {
    return Promise.resolve();
  }
  uploadSave(_save: SaveData): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
  downloadSave(): Promise<SaveData | null> {
    return Promise.resolve(null);
  }
  submitScore(_payload: SubmitScorePayload): Promise<SubmitScoreResult> {
    return Promise.resolve({ ok: true });
  }
  getLeaderboard(_query: LeaderboardQuery): Promise<LeaderboardResult> {
    return Promise.resolve({ list: [] });
  }
}

describe('WechatPlatformAdapter', () => {
  it('kind=wechat，storage 走 wx 同步存储', async () => {
    const { wx } = createFakeWx();
    const adapter = new WechatPlatformAdapter({ wx, log: silentLog });
    expect(adapter.kind).toBe('wechat');
    adapter.storage.set('ltkp.test', 'v');
    expect(adapter.storage.get('ltkp.test')).toBe('v');
    adapter.storage.remove('ltkp.test');
    expect(adapter.storage.get('ltkp.test')).toBeNull();
  });

  it('init 注册分享/生命周期/常亮，并初始化云环境', async () => {
    const { wx, state } = createFakeWx();
    const cloud = new FakeCloud();
    const cloudEvents: string[] = [];
    cloud.init = async (envId: string) => {
      cloudEvents.push(envId);
    };
    const adapter = new WechatPlatformAdapter({
      wx,
      cloud,
      cloudEnvId: 'env-abc',
      log: silentLog,
      lifecycle: {
        onShow: () => cloudEvents.push('show'),
        onHide: () => cloudEvents.push('hide'),
      },
      share: { title: '自定义标题' },
    });
    await adapter.init();
    expect(cloudEvents).toContain('env-abc');
    expect(state.shareMenus[0]?.withShareTicket).toBe(true);
    expect(state.keepScreenOn).toBe(1);
    state.fireShow();
    state.fireHide();
    expect(cloudEvents).toContain('show');
    expect(cloudEvents).toContain('hide');
  });

  it('login 成功返回微信档案；失败降级游客 uid 且可复用', async () => {
    const { wx, state } = createFakeWx();
    const loginOk = new FakeCloud() as FakeCloud & { login: () => Promise<WechatCloudLoginProfile | null> };
    loginOk.login = async () => ({ uid: 'openid-1', nickname: '小明', avatarUrl: 'https://avatar', bestScore: 10 });
    const adapter = new WechatPlatformAdapter({ wx, cloud: loginOk, log: silentLog });
    await expect(adapter.login()).resolves.toEqual({
      uid: 'openid-1',
      nickname: '小明',
      avatarUrl: 'https://avatar',
      isGuest: false,
    });

    const loginNull = new FakeCloud() as FakeCloud & { login: () => Promise<WechatCloudLoginProfile | null> };
    loginNull.login = async () => null;
    const guest = new WechatPlatformAdapter({ wx, cloud: loginNull, log: silentLog });
    const first = await guest.login();
    expect(first.isGuest).toBe(true);
    expect(first.nickname).toBe('酷跑玩家');
    expect(first.uid).toMatch(/^guest_[a-z0-9]{8}$/);
    expect(state.storage.get(WECHAT_GUEST_UID_KEY)).toBe(first.uid);
    const second = await new WechatPlatformAdapter({ wx, cloud: loginNull, log: silentLog }).login();
    expect(second.uid).toBe(first.uid);
  });

  it('pay：未配置/iOS 返回 unsupported，Android 成功与取消', async () => {
    const { wx, state } = createFakeWx();

    const unconfigured = new WechatPlatformAdapter({ wx, log: silentLog, pay: { offerId: '', mode: 'goods', env: 0, currencyType: 'CNY', zoneId: '1', buyQuantity: 1 } });
    await expect(unconfigured.pay({ id: 'p1', priceFen: 600 })).resolves.toEqual({ ok: false, reason: 'unsupported' });

    state.platform = 'ios';
    const ios = new WechatPlatformAdapter({ wx, log: silentLog, pay: { offerId: 'offer-1', mode: 'goods', env: 0, currencyType: 'CNY', zoneId: '1', buyQuantity: 1 } });
    await expect(ios.pay({ id: 'p1', priceFen: 600 })).resolves.toEqual({ ok: false, reason: 'unsupported' });

    state.platform = 'android';
    const android = new WechatPlatformAdapter({ wx, log: silentLog, pay: { offerId: 'offer-1', mode: 'goods', env: 0, currencyType: 'CNY', zoneId: '1', buyQuantity: 1 } });
    state.midasMode = 'success';
    await expect(android.pay({ id: 'p1', priceFen: 600 })).resolves.toEqual({ ok: true });
    expect(state.midas[0]).toMatchObject({ mode: 'goods', offerId: 'offer-1', productId: 'p1', platform: 'android' });

    state.midasMode = 'cancel';
    await expect(android.pay({ id: 'p1', priceFen: 600 })).resolves.toEqual({ ok: false, reason: 'cancel' });
    state.midasMode = 'fail';
    await expect(android.pay({ id: 'p1', priceFen: 600 })).resolves.toEqual({ ok: false, reason: 'fail' });
  });

  it('share/vibrate/copyText/setUserCloudStorage 调用对应 wx API', async () => {
    const { wx, state } = createFakeWx();
    const adapter = new WechatPlatformAdapter({ wx, log: silentLog, share: { title: '默认标题' } });
    await expect(adapter.share({ title: '分享标题' })).resolves.toBe(true);
    expect(state.shares[0]?.title).toBe('分享标题');
    adapter.vibrate('short');
    adapter.vibrate('long');
    adapter.copyText('复制内容');
    adapter.setUserCloudStorage([{ key: 'bestScore', value: '123' }]);
    expect(state.vibes).toEqual(['medium', 'long']);
    expect(state.clipboard).toEqual(['复制内容']);
    expect(state.kv).toEqual([{ key: 'bestScore', value: '123' }]);
  });

  it('原生隐私授权：不需要直接通过；需要时以 requirePrivacyAuthorize 结果为准', async () => {
    const { wx, state } = createFakeWx();
    const adapter = new WechatPlatformAdapter({ wx, log: silentLog });

    state.privacy.need = false;
    await expect(adapter.requestPrivacyAuthorization()).resolves.toBe(true);
    expect(state.privacy.requests).toBe(0);

    state.privacy.need = true;
    state.privacy.authorizeOk = true;
    await expect(adapter.requestPrivacyAuthorization()).resolves.toBe(true);
    expect(state.privacy.requests).toBe(1);

    state.privacy.authorizeOk = false;
    await expect(adapter.requestPrivacyAuthorization()).resolves.toBe(false);

    const { wx: bareWx } = createFakeWx();
    delete bareWx.getPrivacySetting;
    delete bareWx.requirePrivacyAuthorize;
    const bare = new WechatPlatformAdapter({ wx: bareWx, log: silentLog });
    await expect(bare.requestPrivacyAuthorization()).resolves.toBe(true);
  });
});
