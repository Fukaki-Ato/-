/**
 * 网络与资源读取（S10 §4 §fetchJson / extras.readJson·readBinary 行）。
 * fetchJson：wx.request(dataType:'json')，非 2xx 或 fail → reject（两端一致）。
 * readJson/readBinary：包内相对路径走 getFileSystemManager().readFile；
 *   http(s) URL 走 downloadFile→tempFilePath→readFile（S8 CDN 复用同一入口）。
 * S8 前的占位：URL 直读时若无 downloadFile 环境（node mock）则回退 fetchJson 语义。
 */
import type { WxLike } from './wxTypes.js';

export function wxFetchJson(wx: WxLike, url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      dataType: 'json',
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error(`HTTP ${res.statusCode} ${url}`));
      },
      fail: err => reject(new Error(`wx.request 失败: ${err.errMsg} ${url}`)),
    });
  });
}

/** 读文件为字符串（utf8）；downloadFile 中转 http(s) URL。 */
function readText(wx: WxLike, path: string): Promise<string> {
  const open = (filePath: string) => new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: res => resolve(typeof res.data === 'string' ? res.data : ''),
      fail: err => reject(new Error(`readFile 失败: ${err.errMsg} ${filePath}`)),
    });
  });
  if (!/^https?:\/\//i.test(path)) return open(path);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: path,
      success: res => {
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(`HTTP ${res.statusCode} ${path}`)); return; }
        open(res.tempFilePath).then(resolve, reject);
      },
      fail: err => reject(new Error(`downloadFile 失败: ${err.errMsg} ${path}`)),
    });
  });
}

/** 读文件为 ArrayBuffer（贴图/图集/模型）；来源约定同 readText。 */
function readBinary(wx: WxLike, path: string): Promise<ArrayBuffer> {
  const open = (filePath: string) => new Promise<ArrayBuffer>((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: res => resolve(res.data as ArrayBuffer),
      fail: err => reject(new Error(`readFile 失败: ${err.errMsg} ${filePath}`)),
    });
  });
  if (!/^https?:\/\//i.test(path)) return open(path);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: path,
      success: res => {
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(`HTTP ${res.statusCode} ${path}`)); return; }
        open(res.tempFilePath).then(resolve, reject);
      },
      fail: err => reject(new Error(`downloadFile 失败: ${err.errMsg} ${path}`)),
    });
  });
}

export const wxReadJson = async (wx: WxLike, path: string): Promise<unknown> => JSON.parse(await readText(wx, path));
export const wxReadBinary = (wx: WxLike, path: string): Promise<ArrayBuffer> => readBinary(wx, path);
