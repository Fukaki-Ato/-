/** Shared by the page gateway and runtime; presence enables QA, including encoded/mixed-case keys.
 *  手写解析而非 new URLSearchParams(search)：core 层宿主中立（URLSearchParams 是宿主提供物，
 *  wx 运行时没有）；decodeURIComponent 是 ECMAScript 内建，可用。 */
export function debugQueryFlags(search: string): { debug: boolean; test: boolean; qa: boolean } {
  let debug = false, test = false, qa = false;
  for (const part of search.replace(/^[?#]/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodePart(eq === -1 ? part : part.slice(0, eq)).toLowerCase();
    const value = decodePart(eq === -1 ? '' : part.slice(eq + 1));
    if (key === 'debug') debug = true;
    if (key === 'test') test = true;
    if (key === 'anim' || key === 'ui' && value.toLowerCase() === 'demo') qa = true;
  }
  return { debug, test: debug || test, qa: debug || test || qa };
}

/** 宽松解码：+ 按空格（与 URLSearchParams 同口径）；畸形 % 序列原样返回不抛。 */
function decodePart(raw: string): string {
  const s = raw.replace(/\+/g, ' ');
  try { return decodeURIComponent(s); } catch { return s; }
}
