import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WxImage, WxLike } from './wxTypes.js';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const FILTERS: Record<number, THREE.MinificationTextureFilter> = {
  9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter,
};
const WRAPS: Record<number, THREE.Wrapping> = {
  33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping,
};

function pngUri(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += BASE64[bits >>> 18] + BASE64[(bits >>> 12) & 63]
      + (i + 1 < bytes.length ? BASE64[(bits >>> 6) & 63] : '=')
      + (i + 2 < bytes.length ? BASE64[bits & 63] : '=');
  }
  return 'data:image/png;base64,' + encoded;
}

function readImage(wx: Pick<WxLike, 'createImage'>, buffer: ArrayBuffer): Promise<WxImage> {
  return new Promise((resolve, reject) => {
    const image = wx.createImage();
    const clear = () => { image.onload = null; image.onerror = null; };
    image.onload = () => { clear(); resolve(image); };
    image.onerror = () => { clear(); image.src = ''; reject(new Error('WX GLB PNG 解码失败')); };
    try { image.src = pngUri(buffer); }
    catch (error) { clear(); image.src = ''; reject(error); }
  });
}

/** 内嵌 PNG → 原生 WX Image。Image.src Data URI 要求基础库 >=2.11.0：
 * https://developers.weixin.qq.com/minigame/dev/api/render/image/Image.html
 * 不创建 DOM/Blob/self，也不处理外部图片 URI 或其它格式。UTF8 shim 由 runtime 单独安装。 */
export function createWxModelLoader(wx: Pick<WxLike, 'createImage'>): GLTFLoader {
  return new GLTFLoader().register(parser => {
    const textures = new Set<THREE.Texture>();
    let failed = false;
    return {
      name: 'WX_EMBEDDED_PNG',
      afterRoot() { textures.clear(); return null; }, // 成功后由模型拥有纹理。
      async loadTexture(index: number) {
        try {
          const def = parser.json.textures[index];
          const source = parser.json.images[def.source];
          if (source.mimeType !== 'image/png' || source.bufferView === undefined || source.uri !== undefined) {
            throw new Error('WX GLB 纹理仅支持内嵌 PNG');
          }
          const image = await readImage(wx, await parser.getDependency('bufferView', source.bufferView));
          if (failed) { image.src = ''; throw new Error('WX GLB 纹理加载已失败'); }
          const texture = new THREE.Texture();
          texture.image = image;
          texture.flipY = false;
          texture.name = def.name || source.name || '';
          const sampler = parser.json.samplers?.[def.sampler] ?? {};
          texture.magFilter = sampler.magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
          texture.minFilter = FILTERS[sampler.minFilter] ?? THREE.LinearMipmapLinearFilter;
          texture.wrapS = WRAPS[sampler.wrapS] ?? THREE.RepeatWrapping;
          texture.wrapT = WRAPS[sampler.wrapT] ?? THREE.RepeatWrapping;
          // colorSpace 由 GLTFParser.assignTexture 按 map 用途设定（baseColor 为 SRGB，数据图保持默认）。
          texture.needsUpdate = true;
          texture.addEventListener('dispose', () => { image.src = ''; texture.image = null; });
          parser.associations.set(texture, { textures: index });
          textures.add(texture);
          return texture;
        } catch (error) {
          failed = true;
          for (const texture of textures) texture.dispose();
          textures.clear();
          throw error; // 不回落 three 的浏览器图片路径，也不把缺图伪装成成功。
        }
      },
    };
  });
}
