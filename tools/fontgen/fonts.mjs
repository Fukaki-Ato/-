/**
 * fonts.mjs — 系统字体探测与加载（Windows 字体目录）。
 * 注意：opentype.js 不支持 TTC 集合签名（ttcf），本模块自带首字体抽取
 * （重写表目录绝对偏移）；抽取失败则按候选顺序降级到下一个字体。
 */
import { existsSync, readFileSync } from 'node:fs';

export const FONT_DIR = 'C:/Windows/Fonts';

/** 候选顺序 = 优先级。 SimHei 覆盖 GB2312（含 ·…×←↑↓「」等 UI 符号）。 */
export const FONT_CANDIDATES = [
  { file: 'msyh.ttc', name: 'Microsoft YaHei', hint: 'cjk' },
  { file: 'simhei.ttf', name: 'SimHei', hint: 'cjk' },
  { file: 'Deng.ttf', name: 'DengXian', hint: 'cjk' },
  { file: 'simsun.ttc', name: 'SimSun', hint: 'cjk' },
];

export const LATIN_CANDIDATES = [
  { file: 'arial.ttf', name: 'Arial', hint: 'latin' },
  { file: 'msyh.ttc', name: 'Microsoft YaHei', hint: 'latin' },
  { file: 'simhei.ttf', name: 'SimHei', hint: 'latin' },
];

/** 符号回退（主字体缺 ❤♡ 等 UI 符号时补洞）。 */
export const SYMBOL_CANDIDATES = [
  { file: 'seguisym.ttf', name: 'Segoe UI Symbol', hint: 'symbol' },
];

/**
 * TTC（ttcf）抽取第 index 个字体：拷贝整段缓冲并把表目录里的绝对偏移重定位。
 * 返回可交给 opentype.parse 的 ArrayBuffer；非 TTC 原样返回。
 */
export function dettc(buffer, index = 0) {
  const u8 = new Uint8Array(buffer);
  const sig = String.fromCharCode(...u8.subarray(0, 4));
  if (sig !== 'ttcf') return buffer;
  const dv = new DataView(buffer);
  const numFonts = dv.getUint32(8, false);
  if (index >= numFonts) throw new Error(`dettc: index ${index} >= numFonts ${numFonts}`);
  const offset = dv.getUint32(12 + index * 4, false);
  // 从 offset 起是完整 sfnt：头 12 字节 + numTables 个 16 字节目录项
  const numTables = new DataView(buffer, offset + 4, 2).getUint16(0, false);
  const copy = buffer.slice(offset);
  const cdv = new DataView(copy);
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16 + 8; // 目录项内 offset 字段
    cdv.setUint32(p, cdv.getUint32(p, false) - offset, false);
  }
  return copy;
}

/** 探测单个字体文件：{file, exists, loaded, family?, error?}（不抛异常）。 */
export function probeFont(dir, file, opentype) {
  const path = `${dir}/${file}`;
  if (!existsSync(path)) return { file, path, exists: false, loaded: false };
  try {
    const raw = readFileSync(path);
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const font = opentype.parse(dettc(buf));
    return { file, path, exists: true, loaded: true, font, family: font.names?.fontFamily?.en ?? file };
  } catch (e) {
    return { file, path, exists: true, loaded: false, error: e.message };
  }
}

/** 报告全部候选的可用性（gen.mjs --probe / 测试用）。 */
export function probeAll(opentype, dir = FONT_DIR) {
  const seen = new Map();
  for (const c of [...FONT_CANDIDATES, ...LATIN_CANDIDATES]) {
    if (seen.has(c.file)) continue;
    seen.set(c.file, probeFont(dir, c.file, opentype));
  }
  return [...seen.values()];
}

/** 按候选顺序取第一个可解析字体；candidates 缺省 = CJK 列表。 */
export function detectFont(opentype, candidates = FONT_CANDIDATES, dir = FONT_DIR) {
  for (const c of candidates) {
    const p = probeFont(dir, c.file, opentype);
    if (p.loaded) return p;
  }
  return null;
}
