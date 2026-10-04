import { director } from 'cc';
import { SAVE_KEY, type IGameContext, type IStorage } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { createDefaultSave } from '../../core/framework/SaveRepository';
import { Toast } from '../framework/Toast';

const log = new Logger();

/** 主场景名（assets/scenes/Main.scene）。 */
const MAIN_SCENE = 'Main';

/**
 * 重置存档（repo.reset 语义的最小实现，按现有 API 选择）：
 * - 有 ctx：用默认档整体覆盖内存存档并立即 flush（顺带取消节流写回，避免旧数据回写）；
 * - 无 ctx（启动早期失败）：直接清除存储键。
 */
export function resetSave(ctx: IGameContext | null, storage: IStorage | null): void {
  if (ctx) {
    const fresh = createDefaultSave(
      ctx.save.profile,
      ctx.clock.gameDay(),
      ctx.clock.weekKey(),
      ctx.clock.now(),
    );
    Object.assign(ctx.save, fresh);
    ctx.flush();
    return;
  }
  if (storage) {
    storage.remove(SAVE_KEY);
    return;
  }
  log.warn('重置存档失败：存储不可用');
}

/** 重载 Main 场景以重新走启动流程；返回是否成功发起重载。 */
export function restartGame(): boolean {
  try {
    const ok = director.loadScene(MAIN_SCENE);
    if (!ok) log.error(`重载场景失败：${MAIN_SCENE}（请确认 Main.scene 已加入构建）`);
    return ok;
  } catch (err) {
    log.error('重载场景异常', err);
    return false;
  }
}

/** 重置存档并重启回 Boot；重载失败时仅 Toast 提示，不崩溃。 */
export function resetSaveAndRestart(ctx: IGameContext | null, storage: IStorage | null): void {
  resetSave(ctx, storage);
  Toast.show('存档已重置');
  if (!restartGame()) Toast.show('请手动重启游戏以重新初始化');
}
