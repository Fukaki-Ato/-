import type { UiResources } from '@tr/framework/ui/resources.js';
import { wxReadJson } from './network.js';
import { resolveWxAssetPath } from './assetPaths.js';
import type { WxLike } from './wxTypes.js';

/** 微信 Image 解码图片；不依赖浏览器 ImageBitmap、Blob 或 DOM。 */
export function createWxUiResources(wx: WxLike): UiResources {
  return {
    loadJson: path => wxReadJson(wx, path),
    loadImage: path => new Promise((resolve, reject) => {
      const image = wx.createImage();
      const cleanup = (): void => { image.onload = null; image.onerror = null; };
      image.onload = () => { cleanup(); resolve(image); };
      image.onerror = () => { cleanup(); reject(new Error(`图片加载失败：${path}`)); };
      image.src = resolveWxAssetPath(path);
    }),
  };
}
