import { bootWxGame } from './bootstrap.js';
import { createWxRuntime } from './platform/runtime.js';

const runtime = createWxRuntime();
async function start(): Promise<void> {
  runtime.loading('准备海滨跑道');
  try { await bootWxGame(runtime); }
  catch (error) {
    console.error('[tr-wx] startup failed', error);
    runtime.startupError(error, () => { void start(); });
  } finally { runtime.loaded(); }
}
void start();
