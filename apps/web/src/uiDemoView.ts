/**
 * ?ui=demo 控件树（S4 验收演示，S5 迁移前的对照样板）。
 * 覆盖：Label（中英混排/换行/三种对齐/tofu）、Button（primary/normal/disabled/按压反馈）、
 * Panel（九宫格）、ScrollView（拖拽/fling/回弹/裁剪）、List（虚拟化+点击选中）、动态文本。
 * 本文件只在 apps/web（允许 DOM 侧），控件全部来自 @tr/ui（两端同源）。
 */
import {
  Box, Button, Label, List, Panel, ScrollView,
  type UiView,
} from '@tr/framework/ui/index.js';

export interface DemoHandles {
  /** 每帧回调（更新页脚动态文本） */
  frame(tSec: number): void;
  /** 输入事件回执（demo 页脚显示最近一次原始输入） */
  noteInput(desc: string): void;
  /** 供自动化断言读取的状态 */
  state(): { clicks: number; selected: number; lastInput: string; scrollOffset: number; listOffset: number; listWindow: [number, number] };
}

export function buildDemoView(view: UiView): DemoHandles {
  const c = view.theme.colors;
  const st = { clicks: 0, selected: -1, lastInput: '（无）' };

  // ---------- 头部 ----------
  const title = new Label({ text: '雷霆酷跑 · 自绘 UI 演示', fontSizePx: 30, color: c.neon });
  const sub = new Label({
    text: 'SDF 中英混排 Mixed 123 · ♡❤ 符号回退 · 缺字占位 \u{2F800} · THUNDER RUN',
    fontSizePx: 13, color: c.muted,
  });

  // ---------- 按钮行 ----------
  const info = new Label({ text: '点击「开始 · 跑酷！」试试（按钮有按压态）', fontSizePx: 14, color: c.text });
  const btnPrimary = new Button({
    label: '开始 · 跑酷！', variant: 'primary', fontSizePx: 16,
    onClick: () => { st.clicks++; info.setText(`点击次数：${st.clicks}（primary 按钮）`); },
  });
  const btnNormal = new Button({
    label: '清除缓存', fontSizePx: 15,
    onClick: () => info.setText('清除缓存按钮被点击（演示无实际操作）'),
  });
  const btnDisabled = new Button({ label: '禁用按钮', fontSizePx: 15, disabled: true, onClick: () => { st.clicks += 100; } });
  const btnRow = new Box({ direction: 'row', gap: 12, justify: 'center', align: 'center' }, [btnPrimary, btnNormal, btnDisabled]);

  // ---------- 左：文本对齐/换行 ----------
  const alignBody = '自绘 UI 用 SDF 位图字体渲染：放大不糊、单通道图集、中英双图集混排。This paragraph wraps inside the panel with mixed 中英文 content。';
  const panelText = new Panel({ width: 10, flex: 1, align: 'stretch' }, [
    new Label({ text: '文本对齐 / 自动换行', fontSizePx: 17, color: c.gold }),
    new Label({ text: alignBody, fontSizePx: 13, color: c.muted, align: 'left' }),
    new Label({ text: '居中对齐 center', fontSizePx: 13, color: c.text, align: 'center' }),
    new Label({ text: '右对齐 right', fontSizePx: 13, color: c.text, align: 'right' }),
  ]);

  // ---------- 右：ScrollView ----------
  const scrollItems: Label[] = [];
  for (let i = 0; i < 24; i++) {
    scrollItems.push(new Label({
      text: `滚动内容条目 #${String(i).padStart(2, '0')} · 拖拽/fling/越界回弹`,
      fontSizePx: 13,
      color: i % 3 === 0 ? c.neon : i % 3 === 1 ? c.text : c.muted,
    }));
  }
  const scrollView = new ScrollView({
    height: 168,
    content: new Box({ direction: 'column', gap: 7, padding: { top: 2, bottom: 2 } }, scrollItems),
  });
  const panelScroll = new Panel({ width: 10, flex: 1 }, [
    new Label({ text: 'ScrollView（滚出部分被裁剪）', fontSizePx: 17, color: c.gold }),
    scrollView,
  ]);

  // ---------- List：虚拟列表 ----------
  const ITEM_COUNT = 100;
  const itemLabels = new WeakMap<Box, Label>();
  const listLabel = new Label({ text: `List 虚拟列表：${ITEM_COUNT} 项 × 40px，只渲染窗口内条目（含 overscan）`, fontSizePx: 15, color: c.gold });
  const list = new List({
    itemCount: ITEM_COUNT,
    itemExtent: 40,
    height: 200,
    buildItem: i => {
      const label = new Label({ text: `条目 #${i} · 点击选中`, fontSizePx: 14, color: c.text });
      const box = new Box({ direction: 'row', align: 'center', padding: { left: 10, right: 10 } }, [label]);
      itemLabels.set(box, label);
      return box;
    },
    updateItem: (w, i) => itemLabels.get(w as Box)?.setText(`条目 #${i} · 点击选中`),
    onSelect: i => { st.selected = i; info.setText(`选中列表条目 #${i}`); },
  });
  const panelList = new Panel({ align: 'stretch' }, [listLabel, list]);

  // ---------- 页脚（动态文本，每帧刷新） ----------
  const footer = new Label({ text: '', fontSizePx: 12, color: c.muted });

  view.add(new Box({ direction: 'column', gap: 14, padding: 20, align: 'stretch' }, [
    new Box({ direction: 'column', gap: 4, align: 'center' }, [title, sub]),
    btnRow,
    new Box({ align: 'center' }, [info]),
    new Box({ direction: 'row', gap: 14, align: 'stretch' }, [panelText, panelScroll]),
    panelList,
    footer,
  ]));

  return {
    frame(tSec: number) {
      const off = scrollView.physics.offset.toFixed(1);
      const lo = list.physics.offset.toFixed(1);
      const win = list.visibleWindow;
      footer.setText(`t=${tSec.toFixed(1)}s · ScrollView offset=${off}/${scrollView.physics.maxOffset.toFixed(0)} · List offset=${lo} 窗口=[${win.start},${win.end}) · 点击=${st.clicks} · 选中=#${st.selected} · 输入=${st.lastInput}`);
    },
    noteInput(desc: string) { st.lastInput = desc; },
    state: () => ({
      ...st,
      scrollOffset: scrollView.physics.offset,
      listOffset: list.physics.offset,
      listWindow: [list.visibleWindow.start, list.visibleWindow.end] as [number, number],
    }),
  };
}
