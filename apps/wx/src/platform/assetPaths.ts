import { PKG_ASSETS } from './subpackage.js';

/** 仓库 assets/... → 分包路径；已映射路径、URL 与其它本地路径保持原样。 */
export function resolveWxAssetPath(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  const rel = path.replace(/^(\.?\/)+/, '');
  return rel.startsWith('assets/') ? `${PKG_ASSETS}/${rel}` : path;
}
