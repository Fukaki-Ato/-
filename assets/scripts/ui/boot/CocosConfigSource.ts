import { JsonAsset, resources } from 'cc';
import type { ConfigTableName, IConfigSource } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';

const log = new Logger();

/** 配置表资源目录（docs/04 §4.1：resources 下路径不带扩展名）。 */
const CONFIG_DIR = 'config';

/**
 * Cocos 资源系统配置源：resources.load 加载 `config/<table>.json`。
 * 结果按表缓存：平台选择（GameRoot）与 createGameContext 会各取一次 app 表，缓存避免重复加载。
 * 加载失败时 reject，由 ConfigService 汇总为可读的启动错误。
 */
export class CocosConfigSource implements IConfigSource {
  private readonly cache = new Map<ConfigTableName, Promise<unknown>>();

  load(name: ConfigTableName): Promise<unknown> {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const promise = new Promise<unknown>((resolve, reject) => {
      resources.load(`${CONFIG_DIR}/${name}`, JsonAsset, (err, asset) => {
        if (err || !asset) {
          log.error(`配置表加载失败：${CONFIG_DIR}/${name}`, err);
          reject(new Error(`配置表加载失败：${CONFIG_DIR}/${name}`));
          return;
        }
        resolve(asset.json);
      });
    });
    this.cache.set(name, promise);
    promise.catch(() => {
      // 失败不固化缓存，允许重试（启动页重试/清档重启）。
      if (this.cache.get(name) === promise) this.cache.delete(name);
    });
    return promise;
  }
}
