/** GLTFLoader 的完整 UTF-8 缓冲解码；不提供其它编码、fatal 模式或流式解码。 */
export class WxUtf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal = false;
  readonly ignoreBOM = false;

  constructor(label = 'utf-8', options?: { fatal?: boolean; ignoreBOM?: boolean }) {
    if (!['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(label.trim().toLowerCase())) {
      throw new RangeError('WX GLTF decoder only supports UTF-8');
    }
    if (options?.fatal || options?.ignoreBOM) {
      throw new TypeError('WX GLTF decoder does not support fatal or ignoreBOM options');
    }
  }

  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string {
    if (options?.stream) throw new TypeError('WX GLTF decoder does not support streaming');
    const bytes = input === undefined ? new Uint8Array(0) : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    let text = '', i = 0;
    while (i < bytes.length) {
      const first = bytes[i++];
      if (first < 0x80) { text += String.fromCharCode(first); continue; }
      let count: number, point: number, lower = 0x80, upper = 0xbf;
      if (first >= 0xc2 && first <= 0xdf) { count = 1; point = first & 0x1f; }
      else if (first >= 0xe0 && first <= 0xef) {
        count = 2; point = first & 0x0f;
        if (first === 0xe0) lower = 0xa0;
        if (first === 0xed) upper = 0x9f;
      } else if (first >= 0xf0 && first <= 0xf4) {
        count = 3; point = first & 0x07;
        if (first === 0xf0) lower = 0x90;
        if (first === 0xf4) upper = 0x8f;
      } else { text += '\ufffd'; continue; }
      let valid = true;
      for (let j = 0; j < count; j++) {
        const byte = bytes[i];
        if (i === bytes.length || byte < lower || byte > upper) { valid = false; break; }
        i++;
        point = (point << 6) | (byte & 0x3f);
        lower = 0x80; upper = 0xbf;
      }
      text += valid ? String.fromCodePoint(point) : '\ufffd';
    }
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
}

/** 在创建 WX runtime / 首次 GLTFLoader.parse 之前调用；原生实现保持原样。 */
export function installWxTextDecoder(host: { TextDecoder?: unknown } = globalThis): boolean {
  if (host.TextDecoder !== undefined) return false;
  host.TextDecoder = WxUtf8TextDecoder;
  return true;
}
