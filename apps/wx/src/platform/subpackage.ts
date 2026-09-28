/**
 * 分包资源定位辅助（S6 构建管线配套，platform-wx 新增文件——不改 S3 既有模块）。
 * 背景：
 * - WxLike（wxTypes.ts）按 S10「扩面即扩评审面」只声明 S3 用到的 API，没有 loadSubpackage；
 *   这里用结构子集接口补齐，依旧走**参数注入**（可 mock 直测），不破 R5 纪律。
 * - 分包 root 内文件在 wx.loadSubpackage 成功后才可被 getFileSystemManager().readFile 读取；
 *   资源路径统一用「相对代码包根」形式（无开头 '/'），与 extras.readJson/network.ts 的语义衔接。
 * - 旧基础库/纯 node mock 环境无 loadSubpackage：降级为直接 resolve（devtools 模拟器文件始终可读），
 *   真机首包时序由 S7 真机清单复验（load 失败会 reject，不静默）。
 */
import type { WxLike } from './wxTypes.js';

/** 资源分包名（与 apps/wx/game.json subpackages[0].name 一一对应，构建脚本同款常量口径）。 */
export const PKG_ASSETS = 'pkg-assets';

export interface WxSubpackageTask {
  onProgressUpdate?(cb: (res: { progress: number }) => void): void;
  abort?(): void;
}

/** loadSubpackage 能力面（WxLike 之外的最小增量）。 */
export interface WxSubpackageCapable extends WxLike {
  loadSubpackage(opts: {
    name: string;
    success?(res?: unknown): void;
    fail?(err: { errMsg: string }): void;
  }): WxSubpackageTask;
}

/** 分包内资源路径拼接：`subpackageAssetPath('config', 'game.json')` → `pkg-assets/config/game.json`。 */
export function subpackageAssetPath(...segs: string[]): string {
  return [PKG_ASSETS, ...segs].join('/');
}

/**
 * 加载资源分包；成功 resolve 耗时（ms，Date.now 基准仅用于日志），失败 reject。
 * @param onProgress 可选进度回调（0-100，真机网络下载时有值）
 */
export function loadWxSubpackage(wx: WxLike, name = PKG_ASSETS, onProgress?: (p: number) => void): Promise<number> {
  const load = (wx as Partial<WxSubpackageCapable>).loadSubpackage;
  const t0 = Date.now();
  if (typeof load !== 'function') {
    console.warn(`[platform-wx] 运行时缺少 wx.loadSubpackage（旧基础库或 mock），跳过分包加载：${name}`);
    return Promise.resolve(0);
  }
  return new Promise((resolve, reject) => {
    const task = load.call(wx, {
      name,
      success: () => resolve(Date.now() - t0),
      fail: err => reject(new Error(`loadSubpackage 失败: ${err.errMsg} (${name})`)),
    });
    if (onProgress && typeof task?.onProgressUpdate === 'function') {
      task.onProgressUpdate(res => onProgress(res.progress));
    }
  });
}
