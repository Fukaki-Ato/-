import type { UiInput } from '@tr/framework/ui/router.js';
import type { UiResources } from '@tr/framework/ui/resources.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { createWxAdapter } from './wxPlatform.js';
import { getWx, type WxLike } from './wxTypes.js';
import { createWxUiResources } from './uiResources.js';
import { bindWxUiInput } from './uiInput.js';
import { loadWxSubpackage, PKG_ASSETS } from './subpackage.js';
import { installWxTextDecoder } from './textDecoder.js';
import { createWxModelLoader } from './gltfTextures.js';
import { connectWxCloud, type WxCloudClient } from './cloudClient.js';
import type { ModelLoaderFactory } from '@tr/game/render/modelLoader.js';
import { getWxUiInsets, type UiInsets } from './uiInsets.js';
import { createWxStorage } from './storage.js';

export interface WxRuntime {
  adapter: PlatformAdapter;
  resources: UiResources;
  loadAssets(progress?: (percent: number) => void): Promise<number>;
  bindInput(push: (input: UiInput) => void): () => void;
  createModelLoader: ModelLoaderFactory;
  uiInsets(): UiInsets;
  connectCloud(config: unknown): Promise<WxCloudClient | null>;
  loading(title: string): void;
  loaded(): void;
  startupError(error: unknown, retry: () => void): void;
}

export function createWxRuntime(wx: WxLike = getWx()): WxRuntime {
  installWxTextDecoder();
  const adapter = createWxAdapter({ wx });
  const purchaseStorage = createWxStorage(wx, { strict: true });
  return {
    adapter,
    resources: createWxUiResources(wx),
    loadAssets: (progress?: (percent: number) => void) => loadWxSubpackage(wx, PKG_ASSETS, progress),
    bindInput: (push: (input: UiInput) => void) => bindWxUiInput(wx, push, adapter.now),
    createModelLoader: () => createWxModelLoader(wx),
    uiInsets: () => getWxUiInsets(wx),
    connectCloud: config => connectWxCloud(wx, config, purchaseStorage),
    loading(title: string) { wx.showLoading({ title, mask: true }); },
    loaded() { wx.hideLoading(); },
    startupError(error: unknown, retry: () => void) {
      wx.showModal({
        title: '启动失败', content: error instanceof Error ? error.message : String(error),
        confirmText: '重试', cancelText: '关闭',
        success: result => { if (result.confirm) retry(); },
      });
    },
  };
}
