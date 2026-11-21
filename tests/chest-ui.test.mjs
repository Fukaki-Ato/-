/**
 * 宝箱页 UI（canvas 版）：三档卡文案锚点、两步确认、奖励行与动效舞台（ChestStage）。
 * 附：宝箱页新文案字形已进 cjk 字体图集（缺字=tofu，历史上出过回归）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box, Button, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { chestActions, openChest } from '../packages/game/dist/flow/chest.js';
import { readJson, loadTestFontSet } from './ui-helpers.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const W = 800, H = 600;
function makeHost() {
  const store = new Map();
  const adapter = {
    version: 2, env: 'web',
    canvas: {
      mainCanvas: () => ({}), createOffscreenCanvas: () => ({}),
      windowSize: () => ({ width: W, height: H, dpr: 1 }), onResize: () => () => {},
    },
    onInput: () => () => {},
    storage: { get: key => store.get(key) ?? null, set: (key, value) => store.set(key, value), remove: key => store.delete(key) },
    fetchJson: async () => { throw new Error('node 环境不联网'); },
    requestFrame: () => 0, cancelFrame() {}, onVisibility: () => () => {}, now: () => 0,
  };
  return new UiHost({
    adapter, overlayHost: { renderer: null, width: W, height: H, dpr: 1 },
    fonts: loadTestFontSet(), config: defaultUiConfig,
  });
}

async function loadContent() {
  const report = await loadAllConfig(
    { fetchJson: async url => readJson(url.replace(/^\.?\/?/, 'config/')), cacheGet: () => null, cacheSet: () => {} },
    name => `./${name}.json`,
  );
  assert.equal(report.ok, true, report.errors.join('; '));
  return report.content;
}

function labels(host) {
  const result = [];
  host.overlay.current?.root.visit(widget => { if (widget instanceof Label) result.push(widget.getText()); });
  return result.filter(Boolean);
}
function buttons(host) {
  const result = [];
  host.overlay.current?.root.visit(widget => { if (widget instanceof Button) result.push(widget); });
  return result;
}
function findButton(host, label) {
  return buttons(host).find(button => button.label.getText() === label) ?? null;
}
function findWidget(host, predicate) {
  let found = null;
  host.overlay.current?.root.visit(widget => { if (!found && predicate(widget)) found = widget; });
  return found;
}
function click(host, widget) {
  assert.ok(widget, 'interactive widget exists');
  const tree = host.overlay.current.relayout();
  const box = findBox(tree, widget.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

/** 确定性随机：队列式 next()，抽中预置条目后回退 0.5 */
function queueRandom(values) {
  const queue = [...values];
  return () => (queue.length ? queue.shift() : 0.5);
}

test('宝箱页：三档卡齐全、扣价/件数/保底文案、钱包行', async () => {
  const content = await loadContent();
  const host = makeHost();
  const store = new Map([['thunderrun:keys-total', '5']]);
  const storage = { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) };
  const views = createOverlayViews({ host });
  const actions = chestActions(storage, content, () => {});
  views.renderChest(content, actions);

  const t = labels(host);
  for (const s of ['宝箱', '铜宝箱', '银宝箱', '金宝箱', '余额：能量币 0 · 钥匙 5 · 钻石 0',
    '钥匙×1 开一次 · 开出 1 件物品 · 保底8次出高级', '钥匙×2 开一次 · 开出 2 件物品 · 保底6次出高级',
    '钥匙×3 开一次 · 开出 3 件物品 · 保底5次出高级']) {
    assert.ok(t.includes(s), `宝箱页文案 ${s} 可见，实得 ${JSON.stringify(t)}`);
  }
  assert.ok(findButton(host, '开启（钥匙×1）'), '铜箱开启按钮');
  assert.ok(findButton(host, '开启（钥匙×2）'), '银箱开启按钮');
  assert.ok(findButton(host, '开启（钥匙×3）'), '金箱开启按钮');
  host.dispose();
});

test('宝箱页：钥匙不足按钮置灰，不产生确认对', async () => {
  const content = await loadContent();
  const host = makeHost();
  const store = new Map([['thunderrun:keys-total', '0']]);
  const storage = { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) };
  const views = createOverlayViews({ host });
  views.renderChest(content, chestActions(storage, content, () => {}));

  const poor = findButton(host, '钥匙不足');
  assert.ok(poor, '钥匙不足按钮存在');
  assert.equal(poor.state, 'disabled', '置灰不可点');
  assert.equal(findButton(host, '✔ 确认开启'), null, '无确认对');
  host.dispose();
});

test('宝箱页：两步确认开启 → 奖励行/提示/钱包刷新 + 动效舞台被触发', async () => {
  const content = await loadContent();
  const host = makeHost();
  const store = new Map([['thunderrun:keys-total', '3']]);
  const storage = { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) };
  const views = createOverlayViews({ host });
  // 注入固定随机：铜箱抽 coin:200，奖励文案确定
  const bronze = content.economy.params.lootTables.find(t => t.id === 'loot_chest_bronze');
  const total = bronze.entries.reduce((s, e) => s + e.weight, 0);
  const v = pickMid(bronze.entries, 'coin:200', total);
  const actions = {
    onBack: () => {},
    wallet: () => ({ coins: Number(storage.get('thunderrun:coins-total') ?? 0), keys: Number(storage.get('thunderrun:keys-total') ?? 0), diamonds: 0 }),
    chests: () => chestActions(storage, content, () => {}).chests(),
    onOpen: id => openChest(storage, content, id, queueRandom([v])),
  };
  views.renderChest(content, actions);

  const stage = findWidget(host, w => w.constructor.name === 'ChestStage');
  assert.ok(stage, '动效舞台 ChestStage 存在');
  assert.equal(stage.animating, false, '初始静止');

  click(host, findButton(host, '开启（钥匙×1）'));
  const confirm = findButton(host, '✔ 确认开启');
  assert.ok(confirm, '两步确认出现');
  const cancel = findButton(host, '取消');
  assert.ok(cancel, '取消并存');

  click(host, confirm);
  const t = labels(host);
  assert.ok(t.some(s => s.includes('开启成功')), '提示更新（开启成功）');
  assert.ok(t.includes('能量币×200'), '奖励行出现固定抽中的能量币×200');
  assert.ok(t.includes('余额：能量币 200 · 钥匙 2 · 钻石 0'), '钱包行刷新（扣 1 钥匙入 200 币）');
  assert.equal(stage.animating, true, '开启成功后动效时间线启动');
  host.dispose();

  function pickMid(entries, ref, total) {
    let acc = 0;
    for (const e of entries) {
      if (e.ref === ref) return (acc + e.weight / 2) / total;
      acc += e.weight;
    }
    throw new Error('ref not found');
  }
});

test('宝箱页新文案字形已进 cjk 字体图集（缺字=tofu）', () => {
  const charset = new Set(readFileSync(join(root, 'assets', 'fonts', 'charset.txt'), 'utf8'));
  const copy = '宝箱铜银金开启确认取消钥匙不足余额能量币钻石保底次出高级奖励任务活动邮件福利返回成功触发藏秘库点来自与'
    + '余额：能量币 0 · 钥匙 5 · 钻石 0钥匙×1 开一次 · 开出 1 件物品 · 保底8次出高级点宝箱开启，钥匙来自任务、活动与福利邮件奖励暂无宝箱配置×（）·';
  for (const ch of new Set(copy.replace(/\s/g, ''))) {
    assert.ok(charset.has(ch), `字形 ${ch} 已收进 charset（chest 页文案）`);
  }
});
