/**
 * 页面级 keymap（S5，纯逻辑 node 可测）：web 壳把 adapter.onInput 的 key 事件（down 相位）
 * 转发给当前页面的 onKey；本页面无 DOM 输入框，文本录入完全由 code→编辑指令合成。
 * 限制（已记入会话汇报）：InputEvent.key 无修饰键状态（shift 等），故只产出小写字母；
 * 大写/下划线等需要 shift 的字符暂不可录入——测试 openid 为小写字母数字连字符，够用。
 */
export type KeyEdit = { type: 'insert'; ch: string } | { type: 'backspace' } | { type: 'enter' } | null;

const LETTER = /^Key([A-Z])$/;
const DIGIT = /^Digit([0-9])$/;
const NUMPAD = /^Numpad([0-9])$/;

/** KeyboardEvent.code → 文本编辑指令；不可打印/未映射返回 null */
export function keyToEdit(code: string): KeyEdit {
  const letter = LETTER.exec(code);
  if (letter) return { type: 'insert', ch: letter[1]!.toLowerCase() };
  const digit = DIGIT.exec(code);
  if (digit) return { type: 'insert', ch: digit[1]! };
  const numpad = NUMPAD.exec(code);
  if (numpad) return { type: 'insert', ch: numpad[1]! };
  switch (code) {
    case 'Minus': return { type: 'insert', ch: '-' };
    case 'Space': return { type: 'insert', ch: ' ' };
    case 'Backspace': return { type: 'backspace' };
    case 'Enter': case 'NumpadEnter': return { type: 'enter' };
    default: return null;
  }
}

/** 把编辑指令作用到字符串（backspace 删尾；enter/ null 不改）；上限 maxLen 防溢出 */
export function applyKeyEdit(text: string, edit: KeyEdit, maxLen = 64): string {
  if (!edit) return text;
  if (edit.type === 'backspace') return text.slice(0, -1);
  if (edit.type === 'insert') return text.length < maxLen ? text + edit.ch : text;
  return text;
}
