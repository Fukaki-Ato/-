import * as THREE from 'three';
import { loadFontSet, resolveUiConfig, type NinePatchSource, type UiResources } from '@tr/framework/ui/index.js';
import { UiHost } from '@tr/framework/ui/host.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { UiInput } from '@tr/framework/ui/router.js';
import type { UiInsets } from './platform/uiInsets.js';

const PORTRAIT_IDS = ['char_volt', 'char_ama', 'char_kaze', 'char_rina', 'char_bolt',
  'char_frog', 'char_mambo', 'char_niu', 'char_whale', 'char_penguin'];

/** 海滨页面加载各角色自己的已交付肖像；只有一个屏幕画布和 renderer。 */
export async function createWxUiShell(
  adapter: PlatformAdapter, resources: UiResources, gameJson: unknown, injected?: THREE.WebGLRenderer,
  getInsets: () => UiInsets = () => ({ top: 0, bottom: 0 }),
) {
  const textures: THREE.Texture[] = [];
  const load = async (path: string): Promise<NinePatchSource> => {
    const image = await resources.loadImage(path);
    const texture = new THREE.Texture(image as unknown as HTMLImageElement);
    texture.flipY = false; // 与 UI 图集的顶行 UV 约定一致。
    texture.colorSpace = THREE.NoColorSpace; // UI直通shader输出PNG原色，不能再做sRGB→linear解码。
    texture.needsUpdate = true;
    textures.push(texture);
    return { texture, insets: { top: 0, right: 0, bottom: 0, left: 0 }, texSize: { w: image.width, h: image.height } };
  };
  const portraits: Partial<Record<string, NinePatchSource>> = {};
  // allSettled 等待正在解码的资源落定，再统一回收失败启动已经创建的纹理。
  const jobs = await Promise.allSettled([
    loadFontSet(resources, 'assets/fonts/noto'),
    ...PORTRAIT_IDS.map(async id => { portraits[id] = await load(`assets/ui/portraits/${id}.png`); }),
  ]);
  const fontsResult = jobs[0]!;
  const fontSet = fontsResult.status === 'fulfilled' ? fontsResult.value as Awaited<ReturnType<typeof loadFontSet>> : null;
  const failed = jobs.find(job => job.status === 'rejected');
  if (failed?.status === 'rejected') {
    for (const texture of textures) texture.dispose();
    for (const atlas of fontSet?.atlases ?? []) atlas.texture?.dispose();
    throw failed.reason;
  }
  const fonts = fontSet!;
  const config = resolveUiConfig((gameJson as { params?: unknown }).params);
  const renderer = injected ?? new THREE.WebGLRenderer({
    canvas: adapter.canvas.mainCanvas() as unknown as HTMLCanvasElement, antialias: true,
  });
  let size = adapter.canvas.windowSize(), insets = getInsets();
  const uiSize = () => ({ ...size, height: Math.max(1, size.height - insets.top - insets.bottom) });
  renderer.setPixelRatio(size.dpr); renderer.setSize(size.width, size.height, false);
  const uiAdapter: PlatformAdapter = {
    ...adapter,
    canvas: { ...adapter.canvas, windowSize: uiSize,
      onResize: callback => adapter.canvas.onResize(next => {
        size = next; insets = getInsets(); callback(uiSize());
      }),
    },
    requestFrame: callback => adapter.requestFrame(now => {
      renderer.setViewport(0, insets.bottom, size.width, uiSize().height);
      try { callback(now); }
      finally { renderer.setViewport(0, 0, size.width, size.height); }
    }),
  };
  const host = new UiHost({
    adapter: uiAdapter, fonts, config, inputMode: 'raw',
    overlayHost: { renderer, ...uiSize() },
    onViewportSize: () => { renderer.setPixelRatio(size.dpr); renderer.setSize(size.width, size.height, false); },
  });
  return {
    renderer, host, portraits,
    pushInput(input: UiInput) { host.pushInput({ ...input, y: input.y - insets.top }); },
    dispose() {
      host.dispose();
      for (const texture of textures) texture.dispose();
      for (const atlas of fonts.atlases) atlas.texture?.dispose();
      if (!injected) renderer.dispose();
    },
  };
}
