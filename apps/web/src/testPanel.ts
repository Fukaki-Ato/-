/**
 * 测试模式面板（apps/web 专属的 DOM 覆盖层；packages/game 零 DOM 铁律的边界就在这里）。
 * 仅在 URL 带 ?debug 或 ?test 时创建：左侧一列「技能开关」+「一次性技能」，
 * 数据面是 packages/game 挂到 globalThis.__trTest 的测试 API（run 局内才存在）。
 *
 * 输入隔离：面板自身捕获 pointer 事件并 stopPropagation——
 * webPlatform 的手势监听挂在 window 上，不拦住的话点面板会连带触发游戏的双击/滑动。
 */
import type { TestApi, TestToggleDef } from '@tr/game/flow/testApi.js';

interface Row {
  def: TestToggleDef;
  el: HTMLDivElement;
  time: HTMLSpanElement;
}

/** __trAnim.lock 的类型（packages/game 探针；本文件只读不 import，保持 web 壳边界） */
type ClipLock = string | null;

const CSS = `
.tr-test { position: fixed; left: 10px; top: 50%; transform: translateY(-50%); z-index: 20;
  width: 208px; max-height: 82vh; display: flex; flex-direction: column;
  font: 12px/1.5 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #e8f1ff;
  background: rgba(10, 16, 32, .86); border: 1px solid rgba(127, 209, 255, .35); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); overflow: hidden; }
.tr-test header { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: rgba(127, 209, 255, .12); border-bottom: 1px solid rgba(127, 209, 255, .25); cursor: pointer; }
.tr-test header b { font-size: 12px; letter-spacing: .5px; color: #9fd8ff; flex: 1; }
.tr-test header button { all: unset; font-size: 11px; color: #9fd8ff; padding: 1px 6px;
  border: 1px solid rgba(127, 209, 255, .4); border-radius: 5px; cursor: pointer; }
.tr-test .body { overflow-y: auto; padding: 6px 8px 10px; scrollbar-width: thin; }
.tr-test .grp { margin: 8px 2px 4px; font-size: 11px; color: #7f93b5; letter-spacing: .5px; }
.tr-test .row { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.tr-test .row:hover { background: rgba(127, 209, 255, .10); }
.tr-test .row.off { opacity: .62; }
.tr-test .box { flex: none; width: 13px; height: 13px; border-radius: 3px; border: 1px solid rgba(159, 216, 255, .55); }
.tr-test .row.on .box { background: #7fd1ff; border-color: #7fd1ff; box-shadow: 0 0 7px rgba(127, 209, 255, .8); }
.tr-test .lbl { flex: 1; }
.tr-test .t { font-size: 10px; color: #7f93b5; font-variant-numeric: tabular-nums; }
.tr-test .row.on .t { color: #9fd8ff; }
.tr-test .act { display: block; width: 100%; text-align: left; margin: 3px 0; padding: 5px 7px; border-radius: 6px; cursor: pointer;
  color: #e8f1ff; background: rgba(127, 209, 255, .12); border: 1px solid rgba(127, 209, 255, .3); font-size: 11px; }
.tr-test .act:hover { background: rgba(127, 209, 255, .22); }
.tr-test .note { padding: 6px; color: #8fa3c4; font-size: 11px; }
.tr-test .lock { padding: 6px; color: #ffd84d; font-size: 11px; border-top: 1px solid rgba(255, 216, 77, .3); }
`;

export interface TestPanel { dispose(): void }

export function createTestPanel(): TestPanel {
  const enabled = /[?&](debug|test)\b/.test(location.search);
  if (!enabled) return { dispose() {} };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'tr-test';
  const head = document.createElement('header');
  const title = document.createElement('b');
  title.textContent = '测试模式 · 技能开关';
  const allOff = document.createElement('button');
  allOff.textContent = '全关';
  const collapse = document.createElement('button');
  collapse.textContent = '收起';
  head.append(title, allOff, collapse);
  const body = document.createElement('div');
  body.className = 'body';
  root.append(head, body);
  document.body.appendChild(root);

  // 输入隔离：面板上的指针操作不进入游戏手势（webPlatform 的手势监听挂在 window 上）
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const) {
    root.addEventListener(type, e => e.stopPropagation());
  }

  const rows: Row[] = [];
  const actBtns: { primitive: string; el: HTMLButtonElement }[] = [];
  /** 动画锁提示行：?anim= QA 锁曾把角色永久定在末帧（用户实测「一开始好的之后没动作」），
 *  这里让锁的状态可见——生效中 / 已播完自动解锁，并告知去掉 URL 参数即恢复。 */
  const lockNote = document.createElement('div');
  lockNote.className = 'lock';
  lockNote.style.display = 'none';
  let built = false;
  let expanded = true;

  const api = (): TestApi | undefined => (globalThis as Record<string, unknown>).__trTest as TestApi | undefined;

  function build() {
    const a = api();
    if (!a) {
      body.textContent = '';
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = '已开启（?debug）。进入跑酷局后这里会列出可开关的技能。';
      body.appendChild(note);
      body.appendChild(lockNote);
      rows.length = 0; actBtns.length = 0;
      built = false;
      return;
    }
    if (built) return; // 同一局内 API 不变，不重建 DOM
    built = true;
    body.textContent = '';
    rows.length = 0; actBtns.length = 0;
    const groups = new Map<string, TestToggleDef[]>();
    for (const t of a.toggles()) {
      const list = groups.get(t.group) ?? [];
      list.push(t);
      groups.set(t.group, list);
    }
    for (const [group, list] of groups) {
      const g = document.createElement('div');
      g.className = 'grp';
      g.textContent = group;
      body.appendChild(g);
      for (const def of list) {
        const row = document.createElement('div');
        row.className = 'row off';
        const box = document.createElement('span');
        box.className = 'box';
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = def.label;
        const time = document.createElement('span');
        time.className = 't';
        row.append(box, lbl, time);
        row.addEventListener('click', () => {
          const on = !row.classList.contains('on');
          a.set(def.primitive, on);
          row.classList.toggle('on', on);
          row.classList.toggle('off', !on);
        });
        body.appendChild(row);
        rows.push({ def, el: row, time });
      }
    }
    const ga = document.createElement('div');
    ga.className = 'grp';
    ga.textContent = '一次性技能';
    body.appendChild(ga);
    for (const act of a.actions()) {
      const btn = document.createElement('button');
      btn.className = 'act';
      btn.textContent = act.label;
      btn.addEventListener('click', () => a.fire(act.primitive));
      body.appendChild(btn);
      actBtns.push({ primitive: act.primitive, el: btn });
    }
    body.appendChild(lockNote);
  }

  function sync() {
    build();
    const a = api();
    // 动画锁提示：局内以 __trAnim.lock 为准（一次性 clip 播完会自动解锁），局外看 URL
    const anim = (globalThis as Record<string, unknown>).__trAnim as { lock?: ClipLock } | undefined;
    const urlLock = new URLSearchParams(location.search).get('anim');
    const active = anim ? (anim.lock ?? null) : urlLock;
    if (active) {
      lockNote.textContent = `动画锁 ?anim=${active} 生效中（QA 演示；去掉 URL 里的 anim 参数即恢复）`;
      lockNote.style.display = '';
    } else if (urlLock && anim) {
      lockNote.textContent = `动画锁 ${urlLock} 已播完，自动解锁（角色已回状态机）`;
      lockNote.style.display = '';
    } else {
      lockNote.style.display = 'none';
    }
    if (!a) return;
    const state = a.state();
    for (const r of rows) {
      const left = state[r.def.primitive] ?? 0;
      const on = left > 0;
      r.el.classList.toggle('on', on);
      r.el.classList.toggle('off', !on);
      r.time.textContent = on ? (Number.isFinite(left) ? `${Math.ceil(left)}s` : '∞') : '';
    }
  }

  allOff.addEventListener('click', () => api()?.allOff());
  collapse.addEventListener('click', () => {
    expanded = !expanded;
    body.style.display = expanded ? '' : 'none';
    collapse.textContent = expanded ? '收起' : '展开';
  });

  const timer = window.setInterval(sync, 250);
  sync();

  return {
    dispose() {
      window.clearInterval(timer);
      root.remove();
      style.remove();
    },
  };
}
