import type { ShopImageAssets, ShopTexture } from '@tr/game/ui/shopImage.js';

export interface ShopAssetPaths {
  sheet: string;
  coin: string;
  gem: string;
}

export interface ShopAssetLoader {
  load(): Promise<ShopImageAssets | undefined>;
  dispose(): void;
}

export function createShopAssetLoader(
  loadTexture: (path: string, signal: AbortSignal) => Promise<ShopTexture>,
  paths: ShopAssetPaths,
): ShopAssetLoader {
  let pending: Promise<ShopImageAssets | undefined> | null = null;
  let loaded: ShopImageAssets | null = null;
  let disposed = false;
  const controller = new AbortController();
  const owned = new Set<ShopTexture>();
  const released = new WeakSet<ShopTexture>();

  function release(texture: ShopTexture): void {
    if (released.has(texture)) return;
    released.add(texture);
    try {
      texture.texture.dispose();
    } finally {
      try {
        texture.release?.();
      } finally {
        owned.delete(texture);
      }
    }
  }

  function releaseOwned(): void {
    for (const texture of [...owned]) {
      try { release(texture); } catch {}
    }
  }

  async function loadOne(path: string): Promise<ShopTexture | undefined> {
    if (disposed) return undefined;
    const texture = await loadTexture(path, controller.signal);
    if (disposed || controller.signal.aborted) {
      release(texture);
      return undefined;
    }
    owned.add(texture);
    return texture;
  }

  async function loadOnce(): Promise<ShopImageAssets | undefined> {
    try {
      const sheet = await loadOne(paths.sheet);
      if (!sheet) return undefined;
      const coin = await loadOne(paths.coin);
      if (!coin) return undefined;
      const gem = await loadOne(paths.gem);
      if (!gem) return undefined;
      loaded = { sheet, coin, gem };
      return loaded;
    } catch {
      releaseOwned();
      return undefined;
    }
  }

  return {
    load(): Promise<ShopImageAssets | undefined> {
      if (disposed) return Promise.resolve(undefined);
      return pending ??= loadOnce();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      controller.abort();
      releaseOwned();
      loaded = null;
    },
  };
}
