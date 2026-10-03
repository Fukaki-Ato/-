/**
 * S5 页面流转测试（node 端 view model：不渲染像素、不建 WebGL 上下文）。
 * 覆盖：UiHost+页面构造器（headless，three 对象只建不画）、页面信息与交互断言
 * （开始页恰好两个入口 + web 置灰微信登录、大厅四段布局/角色弹层 List/入口方式、HUD onHud 推送、
 * 结算含技能释放次数）、createGameFlow 真实主流程（boot→start→select→result→select，run 需 GL 不进 node）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Box, Button, Label, List, defaultUiConfig, findBox, hitPath, topTarget } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { SlideBox } from '../packages/game/dist/ui/slideOverlay.js';
import { AVATAR_KEYS } from '../packages/game/dist/ui/profileView.js';
import { PLAYER_AVATAR_KEY, PLAYER_NAME_KEY, PLAYER_RENAMES_KEY } from '../packages/game/dist/core/profile/playerProfile.js';
import { createGameFlow, BEST_KEY, CHAR_KEY, COINS_KEY, DIAMOND_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { ENTRY_KEY } from '../packages/game/dist/flow/session.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { readJson, loadTestFontSet } from './ui-helpers.mjs';

const W = 800, H = 600;

function makeHost(env = 'web', extras = undefined) {
  const store = new Map();
  return {
    store,
    adapter: {
      version: 2,
      env,
      extras,
      canvas: {
        mainCanvas: () => ({}),
        createOffscreenCanvas: () => ({}),
        windowSize: () => ({ width: W, height: H, dpr: 1 }),
        onResize: () => () => {},
      },
      onInput: () => () => {},
      storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
      fetchJson: async () => { throw new Error('node 环境不联网'); },
      requestFrame: () => 0,
      cancelFrame: () => {},
      onVisibility: () => () => {},
      now: () => 0,
    },
  };
}

function hostFixture({ env, extras } = {}) {
  const { store, adapter } = makeHost(env, extras);
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width: W, height: H, dpr: 1 }, // headless：tick/render 不被调用
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, adapter, store };
}

/** 收集当前树上全部 Label 文本（HUD toast 用） */
function texts(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Label) out.push(w.getText()); });
  return out.filter(t => t !== '');
}

function findButton(host, label) {
  let found = null;
  host.overlay.current?.root.visit(w => { if (w instanceof Button && w.label.getText() === label) found = w; });
  return found;
}

function allButtons(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Button) out.push(w.label.getText()); });
  return out;
}

const tick = () => new Promise(r => setImmediate(r));

/** 预置全部 config 进内存 storage：boot 网络失败 → configLoader 落到缓存 */
function seedConfigCache(adapter) {
  for (const name of CONTENT_NAMES) {
    adapter.storage.set(`thunderrun:config:${name}`, JSON.stringify(readJson(`config/${name}.json`)));
  }
}

function clickWidget(host, w, tree = host.overlay.tree) {
  const box = findBox(tree, w.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

async function loadContent() {
  const report = await loadAllConfig(
    { fetchJson: async url => readJson(url.replace(/^\.?\/?/, 'config/').replace(/\.json$/, '.json')), cacheGet: () => null, cacheSet: () => {} },
    name => `./${name}.json`,
  );
  assert.equal(report.ok, true, `config 应加载成功：${report.errors.join(';')}`);
  return report;
}

// ---------------- boot 页 ----------------

test('boot 页：setStatus 普通/错误文案上树', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const boot = views.renderBoot();
  assert.ok(texts(host).includes('雷霆酷跑'), '标题');
  boot.setStatus('配置加载失败：\nbad file', true);
  const t = texts(host);
  assert.ok(t.some(x => x.includes('配置加载失败')), `错误文案上树，实得 ${JSON.stringify(t)}`);
});

// ---------------- start 页（品牌封面 + 两个入口） ----------------

test('start 页：品牌标题 + 恰好两个入口按钮，无输入框/校验文案', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  views.renderStart({ wechatAvailable: true, onWechat() {}, onGuest() {} });
  assert.ok(texts(host).includes('雷霆酷跑'), '品牌标题');
  assert.deepEqual(allButtons(host), ['微信登录', '游客登录'], '只有两个入口');
  assert.ok(!texts(host).some(t => t.includes('openid') || t.includes('4-64')), '无账号输入/校验残留');
});

test('start 页：wechatAvailable=false（web）→ 微信登录置灰不回调；游客登录可点', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const acts = [];
  views.renderStart({ wechatAvailable: false, onWechat: () => acts.push('wx'), onGuest: () => acts.push('guest') });
  assert.equal(findButton(host, '微信登录').state, 'disabled');
  clickWidget(host, findButton(host, '微信登录'));
  clickWidget(host, findButton(host, '游客登录'));
  assert.deepEqual(acts, ['guest']);
  assert.ok(texts(host).some(t => t.includes('网页端暂不支持微信登录')), '置灰原因可见');
});

test('start 页：setBusy 锁两个按钮、setFeedback 错误文案上树', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const handle = views.renderStart({ wechatAvailable: true, onWechat() {}, onGuest() {} });
  handle.setBusy(true);
  assert.equal(findButton(host, '微信登录').state, 'disabled');
  assert.equal(findButton(host, '游客登录').state, 'disabled');
  handle.setBusy(false);
  assert.equal(findButton(host, '微信登录').state, 'normal');
  assert.equal(findButton(host, '游客登录').state, 'normal');
  handle.setFeedback('微信登录失败：网络异常', true);
  assert.ok(texts(host).includes('微信登录失败：网络异常'));
});

// ---------------- select 页（大厅：四段布局 + 角色弹层 List） ----------------

test('select 页（大厅）：四段布局齐全、角色弹层点选换角色写本机、开始按钮回传所选', async () => {
  const { host, adapter } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  assert.ok(chars.length >= 2, '夹具需 ≥2 个可出战角色');
  let started = '';
  const views = createOverlayViews({ host });
  views.renderSelect(report.content, {
    onStartRun: id => { started = id; },
    onBack: () => {},
  }, chars[0].id, 'guest');
  view2Pass(host);

  const t0 = texts(host); // 徽标带不可见名牌 Label，texts 可断言板块名
  for (const s of ['商店', '角色', '宝箱', '福利手册', '成就', '任务', '活动', '登录方式：游客登录', '开始·酷跑', '场景切换']) {
    assert.ok(t0.includes(s), `大厅板块 ${s} 可见，实得 ${JSON.stringify(t0)}`);
  }

  // 点底部四联框「角色」格（Box onClick）开弹层
  const charCell = findWidget(host, w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === '角色'));
  assert.ok(charCell, '角色格存在');
  clickWidget(host, charCell);
  // 弹层是挂载后动态加入：overlay.tree 只在 mount/tick 更新，headless 取 relayout 返回值拿新树
  host.overlay.current.relayout();
  const tree = host.overlay.current.relayout();

  const list = findWidget(host, w => w instanceof List);
  assert.ok(list, '角色行 = List 控件');
  assert.ok(list.visibleWindow.end - list.visibleWindow.start >= 2, '横向窗口至少渲染 2 张卡');

  // 点第二张卡：内容坐标 = List 视口左缘 + itemExtent*1.5
  const box = findBox(tree, list.id);
  host.pushInput({ type: 'down', x: box.contentRect.x + 150 * 1.5, y: box.contentRect.y + 20, t: 0 });
  host.pushInput({ type: 'up', x: box.contentRect.x + 150 * 1.5, y: box.contentRect.y + 20, t: 0.05 });
  assert.equal(adapter.storage.get(CHAR_KEY), chars[1].id, '点卡片即写本机');
  assert.ok(texts(host).includes(buildLoadout(report.content, chars[1].id).name), '主体展示随所选刷新');

  // 弹层开着时布局已变：取新树再点开始按钮
  const tree2 = host.overlay.current.relayout();
  const startBadge = findWidget(host, w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === '开始酷跑'));
  clickWidget(host, startBadge, tree2);
  assert.equal(started, chars[1].id);
});

test('select 页（大厅）：入口方式与技能/被动详情、预留板块 toast 占位、无旧返回/清缓存', async () => {
  const { host } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  const views = createOverlayViews({ host });
  views.renderSelect(report.content, { onStartRun() {}, onBack: () => {} }, chars[0].id, 'wechat');
  view2Pass(host);
  const t = texts(host);
  assert.ok(t.includes('登录方式：微信登录'), `入口方式可见，实得 ${JSON.stringify(t)}`);
  assert.ok(!t.some(x => x.includes('配置来源')), '无开发期配置来源行');
  assert.equal(findButton(host, '清除本机缓存'), null, '无清缓存按钮');
  assert.equal(findButton(host, '返回'), null, '大厅不再带旧返回按钮');
  assert.ok(t.includes('开始·酷跑') && t.includes('场景切换'), '主动作标题可见');
  assert.equal(findButton(host, '开始 · 跑酷！'), null, '旧文字按钮已换徽标');

  // 角色弹层内展示技能/被动详情
  const charCell = findWidget(host, w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === '角色'));
  clickWidget(host, charCell);
  const t2 = texts(host);
  assert.ok(t2.some(x => x.includes('技能：') && x.includes('被动：')), '弹层技能/被动详情');

  // 预留板块：点「成就」格 → toast 占位（接口注入后替换）
  const achieveTile = findWidget(host, w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === '成就'));
  clickWidget(host, achieveTile);
  assert.ok(texts(host).some(x => x.includes('开发中')), '预留板块 toast 占位');
});

// ---------------- 玩家档案半屏弹层 ----------------

/** 推进滑入动画并取稳定树（SlideBox 靠 step(dt) 逐帧改 top，headless 得自己喂时间） */
function settle(host) {
  const view = host.overlay.current;
  let tree = null;
  for (let i = 0; i < 6; i++) { view.step(0.5); tree = view.relayout(); }
  return tree;
}

function slideOf(host) { return findWidget(host, w => w instanceof SlideBox); }

/** 点左上角头像开面板，返回布局树（面板内控件的矩形只在开合后有效）
 *  必须显式传新树：换头像会重建头像格，overlay.tree 停在 mount 那一刻，按旧 id 找不到盒子 */
function openProfile(host) {
  const tree = host.overlay.current.relayout();
  clickWidget(host, findWidget(host, cellOf('头像')), tree);
  return settle(host);
}

/** 点面板下方空白（全屏点击捕获层）关闭 */
function tapBelowPanel(host, panelBottom) {
  host.pushInput({ type: 'down', x: 400, y: panelBottom + 60, t: 0 });
  host.pushInput({ type: 'up', x: 400, y: panelBottom + 60, t: 0.05 });
  return settle(host);
}

const cellOf = (text) => (w) => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === text);

test('档案弹层：点头像从顶边滑下，含 ID/最高记录/两组候选，点下方空白收回且不吞大厅点击', async () => {
  const { host, adapter } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  adapter.storage.set(BEST_KEY, '1234');
  createOverlayViews({ host }).renderSelect(report.content,
    { onStartRun() {}, onBack: () => {} }, chars[0].id, 'guest', { coins: 66, diamonds: 30 });
  view2Pass(host);

  const slide = slideOf(host);
  assert.ok(slide, '弹层控件挂在页面上');
  assert.ok(findBox(host.overlay.current.relayout(), slide.id).rect.y < 0, '收起态整块在屏幕上沿之外');

  const tree = openProfile(host);
  const box = findBox(tree, slide.id);
  assert.equal(box.rect.h, Math.round(H * 55 / 100), '面板高 = params.profile.panelHeightPct');
  assert.ok(box.rect.y >= 0 && box.rect.y <= 8, `滑到位贴屏幕上沿，实得 y=${box.rect.y}`);
  const t = texts(host);
  assert.ok(t.some(x => x.startsWith('账号 ID：') && /^[1-9]\d{9}$/.test(x.slice(6))), `10 位账号 ID 可见，实得 ${JSON.stringify(t)}`);
  assert.ok(t.includes('最高记录：1234 米'), '最高记录读自 BEST_KEY');
  assert.ok(t.some(x => x.includes('点头像换一个')) && t.some(x => x.includes('点名字改一个')), '头像/昵称两组候选');
  assert.ok(allButtons(host).includes('闪电少年'), '昵称候选以按钮呈现');
  assert.ok(t.includes('点击下方空白处返回'), '返回提示');

  tapBelowPanel(host, box.rect.h + box.rect.y);
  assert.equal(slideOf(host).isOpen, false, '点空白即收回');
  assert.ok(findBox(host.overlay.current.relayout(), slideOf(host).id).rect.y < 0, '收回后面板回到屏外');

  // 捕获层收起后让出命中：底栏「商店」仍可点到（否则整屏点击都被吃掉）
  const shopTile = findWidget(host, cellOf('商店'));
  clickWidget(host, shopTile, host.overlay.current.relayout());
  assert.ok(texts(host).some(x => x.includes('开发中')), '关闭后大厅点击恢复正常');
});

test('档案弹层：候选头像写本机并刷新顶栏，改名先免费后扣钻、余额不足直接拒', async () => {
  const { host, adapter } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  adapter.storage.set(DIAMOND_KEY, '50');
  createOverlayViews({ host }).renderSelect(report.content,
    { onStartRun() {}, onBack: () => {} }, chars[0].id, 'guest', { coins: 66, diamonds: 50 });
  view2Pass(host);
  openProfile(host);

  // 1) 点候选行里的第二枚头像 → 序号落盘 + 大头像与顶栏头像一起换帧
  const idx = 1;
  clickWidget(host, findWidget(host, cellOf(`头像${AVATAR_KEYS[idx]}`)), host.overlay.current.relayout());
  assert.equal(adapter.storage.get(PLAYER_AVATAR_KEY), String(idx), '点候选头像即写本机');
  assert.ok(texts(host).includes('头像已更换'), '点击有反馈');
  const slide = slideOf(host);
  const bigAvatar = (() => { let f = null; slide.visit(w => { if (w !== slide && !f && cellOf('头像')(w)) f = w; }); return f; })();
  clickWidget(host, bigAvatar, host.overlay.current.relayout());
  assert.equal(adapter.storage.get(PLAYER_AVATAR_KEY), String((idx + 1) % AVATAR_KEYS.length), '点大头像按顺序换下一个');

  // 2) 第一次改名免费
  clickWidget(host, findButton(host, '闪电少年'), host.overlay.current.relayout());
  assert.equal(adapter.storage.get(PLAYER_NAME_KEY), '闪电少年', '名字落盘');
  assert.equal(adapter.storage.get(PLAYER_RENAMES_KEY), '1');
  assert.equal(adapter.storage.get(DIAMOND_KEY), '50', '免费次数不扣钱');
  assert.ok(texts(host).some(x => x.includes('已改名为「闪电少年」（免费）')));

  // 3) 第二次扣 config 里的 20 钻，顶栏钻石数字同步
  clickWidget(host, findButton(host, '椰子骑士'), host.overlay.current.relayout());
  assert.equal(adapter.storage.get(DIAMOND_KEY), '30', '扣费落盘');
  assert.equal(adapter.storage.get(PLAYER_NAME_KEY), '椰子骑士');
  assert.ok(texts(host).includes('30'), '顶栏钻石数字刷新');
  assert.ok(texts(host).some(x => x.includes('每次 20 钻')), '免费次数用完，提示改成价格');

  // 4) 余额不足：拒绝且不扣费、不计数
  adapter.storage.set(DIAMOND_KEY, '5');
  clickWidget(host, findButton(host, '风驰电掣'), host.overlay.current.relayout());
  assert.equal(adapter.storage.get(DIAMOND_KEY), '5', '钱不够不能改动余额');
  assert.equal(adapter.storage.get(PLAYER_NAME_KEY), '椰子骑士', '名字不变');
  assert.equal(adapter.storage.get(PLAYER_RENAMES_KEY), '2', '次数不涨');
  assert.ok(texts(host).some(x => x.includes('钻石不足')), '给出缺钻原因');

  // 5) 点自己当前名 → 提示同名，同样不扣不计数
  clickWidget(host, findButton(host, '椰子骑士'), host.overlay.current.relayout());
  assert.ok(texts(host).some(x => x.includes('已经是这个名字了')));
  assert.equal(adapter.storage.get(PLAYER_RENAMES_KEY), '2');

  // 6) 关掉再开：档案与 ID 都还在（本机记忆，不是每次重新发号）
  const idShown = texts(host).find(x => x.startsWith('账号 ID：'));
  tapBelowPanel(host, findBox(host.overlay.current.relayout(), slide.id).rect.h);
  openProfile(host);
  assert.equal(texts(host).find(x => x.startsWith('账号 ID：')), idShown, '重开面板 ID 不变');
  assert.equal(texts(host).includes('椰子骑士'), true, '重开面板名字读回本机记忆');
});

test('toast：出现在画面中间并随时间向下漂走，不占页面高度也不吃底下的点击', async () => {
  const { host } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  createOverlayViews({ host }).renderSelect(report.content,
    { onStartRun() {}, onBack: () => {} }, chars[0].id, 'guest');
  view2Pass(host);
  const v = host.overlay.current;
  // 旧版 toast 层是 in-flow 列 + padding.bottom 28，会从页面高度里扣掉 28px，
  // 屏幕底下永远露出一条主题底色（用户反馈的「黑框」）
  assert.equal(v.relayout().children[0].rect.h, H, 'toast 层不得占常规流');

  host.toast('「商店」开发中，敬请期待');
  let chip = v.relayout().children[1].children[0];
  assert.ok(chip, 'toast 胶囊上树');
  assert.ok(chip.rect.h > 20 && chip.rect.w > 100, `胶囊有实测尺寸，实得 ${JSON.stringify(chip.rect)}`);
  assert.ok(Math.abs(chip.rect.y - H * 0.45) <= 2, `起点在画面中间，实得 y=${chip.rect.y}`);
  assert.ok(Math.abs(chip.rect.x + chip.rect.w / 2 - W / 2) <= 2, '水平居中');
  assert.equal(v.relayout().children[1].rect.w, 0, '锚点零宽 ⇒ 整棵 toast 子树不参与命中');

  const y0 = chip.rect.y;
  for (let i = 0; i < 30; i++) { v.step(0.05); v.relayout(); } // 推进 1.5s（寿命 2.2s）
  chip = v.relayout().children[1].children[0];
  assert.ok(chip.rect.y > y0 + 20, `随时间向下漂移：${y0} → ${chip.rect.y}`);
  assert.ok(chip.rect.y < y0 + 120, `漂移幅度受限，实得位移 ${Math.round(chip.rect.y - y0)}`);

  // 提示条悬在画面上时，底下的板块照样点得动（命中链不能被 toast 截断）
  const shop = findWidget(host, cellOf('商店'));
  const tree = v.relayout();
  const sb = findBox(tree, shop.id);
  const path = hitPath(tree, sb.rect.x + sb.rect.w / 2, sb.rect.y + sb.rect.h / 2);
  const tgt = topTarget(path);
  let inside = false;
  shop.visit(w => { if (tgt && w.id === tgt.id) inside = true; });
  assert.ok(inside, `toast 不截断点击，命中仍是商店格内部，实得 ${tgt && tgt.id}`);
  clickWidget(host, shop, tree);
  assert.ok(texts(host).some(x => x.includes('开发中')), '点击照常触发');
});

test('背景可见性：只有大厅页报 true（boot/start 关、进跑酷局关）', async () => {
  const { host } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  const seen = [];
  const views = createOverlayViews({ host, onLobbyVisible: v => seen.push(v) });
  views.renderBoot();
  views.renderStart({ wechatAvailable: false, onWechat() {}, onGuest() {} });
  views.renderSelect(report.content, { onStartRun() {}, onBack: () => {} }, chars[0].id, 'guest');
  views.mountHud().dispose();
  assert.deepEqual(seen, [false, false, true, false], '背景视频（若有）只在大厅那一屏解码');
});

function findWidget(host, pred) {
  let found = null;
  host.overlay.current?.root.visit(w => { if (!found && pred(w)) found = w; });
  return found;
}

/** Label 两遍收敛 + List 视口测量回填：再排一遍拿稳定树 */
function view2Pass(host) {
  host.overlay.current?.relayout();
  host.overlay.current?.relayout();
}

// ---------------- HUD（onHud 推送数据源） ----------------

test('HUD：分数/金币/里程/爱心 + buff 同名合并 + 技能三态文案', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const hud = views.mountHud();
  hud.update({ score: 1234, coins: 9, distance: 105.2, hits: 1, lives: 3, buffs: [], skill: null });
  const line = texts(host).find(t => t.includes('分 ·'));
  assert.ok(line.includes('1,234 分') && line.includes('9 金币') && line.includes('105 m') && line.includes('❤'), line);
  assert.ok(line.includes('♡'), '受击掉心');
  hud.update({
    score: 2000, coins: 10, distance: 200, hits: 0, lives: 3,
    buffs: [{ name: '雷神护体', left: 5 }, { name: '雷神护体', left: 8 }, { name: '永固', left: Infinity }],
    skill: { label: '雷霆瞬步', energy: 0.5, cd: 0, ready: false },
  });
  const t2 = texts(host);
  assert.ok(t2.some(x => x.includes('雷神护体 8s') && !x.includes('5s')), '同名 buff 取最长剩余');
  assert.ok(t2.some(x => x.includes('永固') && !/永固 \d/.test(x)), '永久被动不显倒计时');
  assert.ok(t2.some(x => x === '雷霆瞬步：能量 50%'), '技能能量态');
  hud.update({ score: 2000, coins: 10, distance: 200, hits: 0, lives: 3, buffs: [], skill: { label: '雷霆瞬步', energy: 1, cd: 2.5, ready: false } });
  assert.ok(texts(host).some(x => x.startsWith('雷霆瞬步：冷却 2.5s')));
  hud.update({ score: 2000, coins: 10, distance: 200, hits: 0, lives: 3, buffs: [], skill: { label: '雷霆瞬步', energy: 1, cd: 0, ready: true } });
  assert.ok(texts(host).some(x => x.includes('就绪（双击 / E）')));
  hud.dispose();
  assert.equal(host.overlay.current, null, 'dispose 即卸页');
});

// ---------------- result 页 ----------------

test('result：新纪录标题/大分/技能释放次数/历史最佳 + 两按钮回调', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const acts = [];
  views.renderResult(
    { t: 61.5, distance: 800.4, coins: 40, nearMiss: 7, hits: 2, score: 999, alive: false, casts: 3, charId: 'char_volt' },
    500,
    { onRetry: () => acts.push('retry'), onSelect: () => acts.push('select') },
  );
  const t = texts(host);
  assert.ok(t.includes('新纪录！'), 'score>best 且 >0 → 新纪录（同分不算）');
  assert.ok(t.includes('999'), '大分数行');
  assert.ok(t.some(x => x === '3 次 · char_volt'), `技能释放行，实得 ${JSON.stringify(t)}`);
  assert.ok(t.some(x => x === '800 m' || x.includes('800 m')));
  assert.ok(t.includes('999'), '历史最佳=刷新后');
  clickWidget(host, findButton(host, '再跑一次'));
  clickWidget(host, findButton(host, '返回选角'));
  assert.deepEqual(acts, ['retry', 'select']);
});

// ---------------- mainFlow 真实主流程（不进 run：node 无 GL） ----------------

test('flow（web）：boot→start→(游客)→select 大厅；result→返回选角', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  seedConfigCache(adapter);
  await flow.boot();
  assert.equal(flow.machine.current(), 'start');
  assert.ok(texts(host).includes('雷霆酷跑'));
  assert.equal(findButton(host, '微信登录').state, 'disabled', 'web 壳 extras.login 是游客兜底，不作微信登录');

  clickWidget(host, findButton(host, '微信登录'));
  await tick();
  assert.equal(flow.machine.current(), 'start', '置灰的微信登录不触发流转');

  clickWidget(host, findButton(host, '游客登录'));
  assert.equal(flow.machine.current(), 'select');
  assert.equal(adapter.storage.get(ENTRY_KEY), 'guest', '本机记住入口方式');
  assert.ok(texts(host).includes('开始·酷跑'));
  assert.ok(texts(host).includes('登录方式：游客登录'));

  flow.machine.go('result', {
    t: 10, distance: 300, coins: 5, nearMiss: 1, hits: 0, score: 120, alive: false, casts: 1, charId: 'char_volt',
  });
  assert.equal(flow.machine.current(), 'result');
  assert.equal(adapter.storage.get(BEST_KEY), '120', '结算写最佳');
  assert.equal(adapter.storage.get(COINS_KEY), '5', '结算累加金币总和');
  clickWidget(host, findButton(host, '返回选角'));
  assert.equal(flow.machine.current(), 'select');
});

test('flow（wx）：微信登录成功 → select 并记住 wechat；选角页显示入口方式', async () => {
  let calls = 0;
  const extras = { login: async () => { calls++; return { openid: 'wx-guest-abc', isGuest: true }; } };
  const { host, adapter } = hostFixture({ env: 'wx', extras });
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  seedConfigCache(adapter);
  await flow.boot();
  assert.equal(findButton(host, '微信登录').state, 'normal');
  clickWidget(host, findButton(host, '微信登录'));
  await tick();
  assert.equal(calls, 1, '经注入的 extras.login() 登录');
  assert.equal(flow.machine.current(), 'select');
  assert.equal(adapter.storage.get(ENTRY_KEY), 'wechat');
  assert.ok(texts(host).includes('登录方式：微信登录'));
});

test('flow（wx）：微信登录失败 → 停留 start、显示反馈、按钮恢复可重试', async () => {
  const extras = { login: async () => { throw new Error('wx.login 失败: fail'); } };
  const { host, adapter } = hostFixture({ env: 'wx', extras });
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  seedConfigCache(adapter);
  await flow.boot();
  clickWidget(host, findButton(host, '微信登录'));
  await tick();
  assert.equal(flow.machine.current(), 'start');
  assert.ok(texts(host).some(t => t.startsWith('微信登录失败') && t.includes('wx.login 失败')), '失败原因可见');
  assert.equal(findButton(host, '微信登录').state, 'normal', '可重试');
  assert.equal(adapter.storage.get(ENTRY_KEY) ?? null, null, '失败不记入口');
  clickWidget(host, findButton(host, '游客登录'));
  assert.equal(flow.machine.current(), 'select', '失败后仍可改选游客');
});

test('flow：配置全缺 → 停在 boot 并显示错误（不静默吞错）', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: n => `./${n}.json` });
  await flow.boot();
  assert.equal(flow.machine.current(), 'boot');
  assert.ok(texts(host).some(t => t.includes('配置加载失败')));
});
