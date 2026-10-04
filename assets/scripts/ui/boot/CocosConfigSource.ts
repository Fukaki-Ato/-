import { JsonAsset, resources } from 'cc';
import type { ConfigTableName, IConfigSource } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';

const log = new Logger();

/** 配置表资源目录（docs/04 §4.1：resources 下路径不带扩展名）。 */
const CONFIG_DIR = 'config';

/**
 * Cocos 资源系统配置源：resources.load 加载 `config/<table>.json`。
 * 加载失败时 reject，由 ConfigService 汇总为可读的启动错误。
 */
export class CocosConfigSource implements IConfigSource {
  load(name: ConfigTableName): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      resources.load(`${CONFIG_DIR}/${name}`, JsonAsset, (err, asset) => {
        if (err || !asset) {
          log.error(`配置表加载失败：${CONFIG_DIR}/${name}`, err);
          reject(new Error(`配置表加载失败：${CONFIG_DIR}/${name}`));
          return;
        }
        resolve(asset.json);
      });
    });
  }
}
