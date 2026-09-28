/**
 * 登录页（P2）：对照 DOM screens.renderLogin——两端同一 view，差异只在注入：
 * - web：保留测试 openid/用户名输入（物理键盘经 onKey → keys.ts 合成录入）；
 * - wx：autoLogin 注入（WxExtras.login 占位 → 游客 openid 自动填进同一输入位）。
 * 变化：口令字段退役（M3 后端未接、wx openid 流无口令，见迁移对照表）；
 *       校验规则放宽为 openid/用户名 [A-Za-z0-9_-]{4,64}（真实校验在服务端，docs/04）。
 */
import { Box, Button, Label, Panel, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { LoginHandle } from '../flow/views.js';
import { createField, type FieldHandle } from './parts.js';
import { keyToEdit } from './keys.js';

export const LAST_USER_KEY = 'thunderrun:lastUser';
const OPENID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export interface LoginDeps {
  actions: { onGuest(): void };
  /** wx 侧注入：WxExtras.login 占位（guest）返回 openid；web 侧不传（手动输入测试 openid） */
  autoLogin?: () => Promise<string>;
}

export interface LoginPage {
  view: UiView;
  handle: LoginHandle;
  onKey(code: string): void;
  frame(tSec: number): void;
  /** 测试/调试：当前输入值 */
  fieldValue(): string;
}

export function buildLoginPage(host: UiHost, d: LoginDeps): LoginPage {
  const c = host.theme.colors;
  const view = host.makeView();
  const err = new Label({ text: '', fontSizePx: 12, color: c.danger });

  let field: FieldHandle;
  const doSubmit = (): void => {
    const v = field.value().trim();
    if (!OPENID_RE.test(v)) {
      err.setText('openid/用户名需为 4-64 位字母、数字、下划线或连字符');
      return;
    }
    err.setText('');
    // M3 前无后端：记本地直接进主菜单（演示流转，与 DOM 版一致）
    host.adapter.storage.set(LAST_USER_KEY, v);
    d.actions.onGuest();
  };

  field = createField({
    colors: c, solid: host.solidSkin,
    placeholder: 'openid / 用户名（4-64 位，网页端直接打字）',
    maxLen: 64,
    onPick: f => { f.setFocused(true); },
  });
  field.setFocused(true);

  const card = new Panel(
    { width: { percent: 92 }, maxWidth: 430, direction: 'column', gap: 10,
      padding: { top: 24, bottom: 20, left: 24, right: 24 } },
    [
      new Label({ text: '进入新澪市', fontSizePx: 22, color: c.text }),
      new Label({
        text: '用账号/openid 登录，或先以游客身份试玩（进度保存在本机）。',
        fontSizePx: 13, color: c.muted,
      }),
      field.box,
      err,
      new Box({ direction: 'row', gap: 10, padding: { top: 4 } }, [
        new Button({ label: '登录 / 注册', variant: 'primary', fontSizePx: 15, onClick: doSubmit }),
        new Button({ label: '游客进入（进度存本机）', fontSizePx: 14, onClick: d.actions.onGuest }),
      ]),
      new Label({
        text: '提示：后端账号接口在 M3 里程碑接入（docs/04）；wx 端由 WxExtras.login 自动注入 openid（游客）。',
        fontSizePx: 11, color: c.muted,
      }),
    ],
  );
  view.add(new Box({ direction: 'column', align: 'center', justify: 'center', flex: 1, padding: 16 }, [card]));

  d.autoLogin?.().then(id => field.setValue(id)).catch(() => { /* 注入失败停留在手输（与游客按钮等价） */ });

  return {
    view,
    handle: { submit: doSubmit },
    onKey(code) {
      const edit = keyToEdit(code);
      if (!edit) return;
      if (edit.type === 'enter') { doSubmit(); return; }
      field.applyEdit(edit);
    },
    frame(tSec) { field.frame(tSec); },
    fieldValue: () => field.value(),
  };
}
