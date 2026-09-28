/**
 * WxExtras —— wx 侧专属能力，可选注入（PlatformAdapter v2 §4，S10 契约 / D7）。
 * 挂载为 PlatformAdapter.extras：
 * - wx 实现必须全量提供；
 * - web 壳提供 no-op / fetch 兜底实现（readJson→fetchJson、login→游客、share→console、cloud→兜底），
 *   业务代码可无分支调用，「网页调试壳走通全流程」不被 wx 能力缺失卡死。
 * 开放数据域好友排行**不进**本接口：独立沙箱（另一次 canvas + 受限 API），
 * 走 openDataContext 子包 + postMessage，S9 单独设计（redesign §7 风险 5）。
 */

/** 登录结果。web 壳 no-op 实现返回游客身份（openid 为本地生成的测试串，isGuest=true）。 */
export interface WxIdentity {
  openid: string;
  isGuest: boolean;
}

/** 定向分享参数（S9），映射 wx.shareAppMessage。 */
export interface ShareOptions {
  title: string;
  /** 回流场景识别用的 query 串（如 "score=1234&from=share"）。 */
  query?: string;
  imageUrl?: string;
}

/** 云能力桥（S9 实装；此前占位，占位语义见 platform-wx/extras.ts）。 */
export interface CloudBridge {
  /** 通用云函数调用（wx.cloud.callFunction）。 */
  callFunction(name: string, data?: unknown): Promise<unknown>;
  /** 账号级存档写入（云开发 DB，key 主键含 openid；换机不丢档）。 */
  saveProgress(key: string, data: unknown): Promise<void>;
  /** 账号级存档读取；无记录 resolve null。 */
  loadProgress(key: string): Promise<unknown | null>;
  /** 分数上报（榜单数据源）。 */
  submitScore(score: number, meta?: Record<string, unknown>): Promise<void>;
}

export interface WxExtras {
  /** wx.login → code → 云函数 code2session → openid（S9；替换登录页本地格式校验）。 */
  login(): Promise<WxIdentity>;
  /** 主动分享（S9 含结算页「炫耀一下」带分口令）。 */
  share(opts: ShareOptions): void;
  readonly cloud: CloudBridge;
  /**
   * 读 JSON 资源（S6 实装分包，S8 接 CDN manifest）。
   * path 为包内相对路径（分包资源，wx.getFileSystemManager 读）或 http(s) URL（wx.downloadFile→缓存→读）。
   */
  readJson(path: string): Promise<unknown>;
  /** 读二进制资源（贴图/字体图集/模型），来源约定同 readJson。 */
  readBinary(path: string): Promise<ArrayBuffer>;
  /** IAA 预留（S9.4：只定义不实装）：激励视频，resolve 观看结果。 */
  showRewardAd?(unitId: string): Promise<'rewarded' | 'closed' | 'failed'>;
  /** 订阅消息预留（S9.4：只定义不实装）。 */
  requestSubscribeMessage?(templateIds: readonly string[]): Promise<void>;
}
