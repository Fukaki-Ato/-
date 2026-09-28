/**
 * 配置装载器（core 层）
 * 对应文档：docs/03 §7（热更新机制）、docs/09 T0.4。
 * 回退链：网络(manifest/url) -> 本地缓存 -> 视为失败。任何来源的数据都必须先过校验。
 * 注意：core 不直接碰 fetch/localStorage，全部通过构造时注入的宿主能力（平台适配层提供）。
 */
import { CONTENT_NAMES } from './configTypes.js';
import type { GameContent } from './configTypes.js';
import { validateFile, validateRefs } from './configValidator.js';

/** 注入的最小宿主能力：读网络、读写本地缓存 */
export interface ConfigHost {
  fetchJson(url: string): Promise<unknown>;
  cacheGet(key: string): string | null;
  cacheSet(key: string, value: string): void;
}

/** 每个文件的来源，用于在 UI 上展示「配置从哪来」 */
export type FileSource = 'network' | 'cache' | 'failed';

export interface LoadReport {
  content: GameContent;
  sources: Record<string, FileSource>;
  errors: string[];
  ok: boolean;
}

const CACHE_PREFIX = 'thunderrun:config:';

/**
 * 加载全部配置文件。
 * @param urlFor 名称 -> 请求地址（如 name => `./config/${name}.json`）
 */
export async function loadAllConfig(host: ConfigHost, urlFor: (name: string) => string): Promise<LoadReport> {
  const content = {} as Record<string, unknown>;
  const sources: Record<string, FileSource> = {};
  const errors: string[] = [];

  for (const name of CONTENT_NAMES) {
    let data: unknown = null;
    let source: FileSource = 'failed';
    // 1) 网络
    try {
      data = await host.fetchJson(urlFor(name));
      source = 'network';
    } catch {
      // 2) 本地缓存兜底
      const cached = host.cacheGet(CACHE_PREFIX + name);
      if (cached) {
        try { data = JSON.parse(cached); source = 'cache'; } catch { data = null; }
      }
    }
    if (data == null) {
      errors.push(`${name}: 网络与缓存均不可用`);
      sources[name] = 'failed';
      continue;
    }
    // 3) 任何来源都要过校验（坏数据宁可不落地）
    const fileErrors = validateFile(name, data);
    if (fileErrors.length > 0) {
      errors.push(...fileErrors);
      sources[name] = 'failed';
      continue;
    }
    content[name] = data;
    sources[name] = source;
    if (source === 'network') host.cacheSet(CACHE_PREFIX + name, JSON.stringify(data));
  }

  const missing = CONTENT_NAMES.filter(n => content[n] == null);
  const ok = missing.length === 0;
  const report: LoadReport = { content: content as unknown as GameContent, sources, errors, ok };
  if (ok) report.errors.push(...validateRefs(content as unknown as GameContent));
  if (report.errors.length > 0) report.ok = false;
  return report;
}
