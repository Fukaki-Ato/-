import { CONTENT_NAMES } from '@tr/game/core/config/configTypes.js';

/** 启动期预取并复用配置；boot 后清空，不改变后续热更新的读取语义。 */
export function preloadStartupConfig(
  fetchJson: (url: string) => Promise<unknown>,
  resolve: (name: string) => string,
): { fetchJson: (url: string) => Promise<unknown>; clear(): void } {
  const requests = new Map<string, Promise<unknown>>();
  const load = (url: string): Promise<unknown> => {
    const existing = requests.get(url);
    if (existing) return existing;
    // 同步抛错也转为 rejection；预取失败不产生未处理异常，正式读取仍会得到同一失败。
    const request = Promise.resolve().then(() => fetchJson(url));
    requests.set(url, request);
    void request.catch(() => undefined);
    return request;
  };
  for (const name of CONTENT_NAMES) load(resolve(name));
  return { fetchJson: load, clear: () => requests.clear() };
}
