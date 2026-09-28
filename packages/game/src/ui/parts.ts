/**
 * 页面共用小件（S5）：文本输入位（自绘，物理键盘经 keys.ts 注入）与色块/信息行。
 * 只组合 @tr/ui 基础控件，零 DOM。
 */
import { Box, Label, type NinePatchSource, type ThemeColors } from '@tr/framework/ui/index.js';
import { applyKeyEdit, keyToEdit, type KeyEdit } from './keys.js';

export interface FieldOptions {
  colors: ThemeColors;
  /** 白色实底皮肤（UiHost.solidSkin，焦点条/光标用） */
  solid: NinePatchSource;
  placeholder: string;
  maxLen?: number;
  /** 点击（拾焦）回调 */
  onPick?: (f: FieldHandle) => void;
}

export interface FieldHandle {
  readonly box: Box;
  value(): string;
  setValue(s: string): void;
  setFocused(f: boolean): void;
  focused(): boolean;
  /** 应用一条编辑指令（来自 keyToEdit）；返回文本是否变化 */
  applyEdit(edit: KeyEdit): boolean;
  /** 光标闪烁（页面 frame 转发） */
  frame(tSec: number): void;
}

export function createField(opts: FieldOptions): FieldHandle {
  const c = opts.colors;
  const maxLen = opts.maxLen ?? 64;
  let text = '';
  let focused = false;

  const focusBar = new Box({ width: 4, height: 22, background: opts.solid, backgroundColor: c.neon });
  focusBar.visible = false;
  const valueLabel = new Label({ text: '', fontSizePx: 15, color: c.text });
  const placeholderLabel = new Label({ text: opts.placeholder, fontSizePx: 15, color: c.muted, opacity: 0.8 });
  const caret = new Box({ width: 2, height: 18, background: opts.solid, backgroundColor: c.text });
  const inner = new Box({ direction: 'row', flex: 1, align: 'center', gap: 4 }, [valueLabel, placeholderLabel, caret]);
  const box = new Box(
    { direction: 'row', height: 46, background: 'card', padding: { left: 10, right: 12 }, gap: 8, align: 'center',
      onClick: () => opts.onPick?.(handle) },
    [focusBar, inner],
  );

  function refresh(): void {
    const has = text.length > 0;
    valueLabel.setText(text);
    valueLabel.visible = has;
    placeholderLabel.visible = !has;
    caret.visible = focused;
    focusBar.visible = focused;
  }
  refresh();

  const handle: FieldHandle = {
    box,
    value: () => text,
    setValue(s) { text = s.slice(0, maxLen); refresh(); },
    setFocused(f) { focused = f; refresh(); },
    focused: () => focused,
    applyEdit(edit) {
      if (!edit || edit.type === 'enter') return false;
      const next = applyKeyEdit(text, edit, maxLen);
      if (next === text) return false;
      text = next;
      refresh();
      return true;
    },
    frame(tSec) {
      if (!focused) return;
      caret.visible = Math.floor(tSec * 2) % 2 === 0; // 0.5s 亮 0.5s 灭
    },
  };
  return handle;
}

/** 消费一次 key down：映射失败返回 null（页面据此决定是否吞键） */
export function fieldEditFromKey(field: FieldHandle, code: string): KeyEdit | null {
  const edit = keyToEdit(code);
  if (edit && field.applyEdit(edit)) return edit;
  return edit;
}

/** 纯色圆角色块（角色 chip / 状态点） */
export function solidChip(solid: NinePatchSource, size: number, color: string): Box {
  return new Box({ width: size, height: size, background: solid, backgroundColor: color });
}

/** 结算信息行：左标签（muted）+ 右值（text 加粗感用亮色替代），spaceBetween */
export function kvRow(colors: ThemeColors, key: string, val: string): Box {
  return new Box(
    { direction: 'row', justify: 'spaceBetween', align: 'center', padding: { top: 5, bottom: 5, left: 4, right: 4 } },
    [
      new Label({ text: key, fontSizePx: 13, color: colors.muted }),
      new Label({ text: val, fontSizePx: 13, color: colors.text }),
    ],
  );
}
