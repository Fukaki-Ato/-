# 开放数据域（好友排行榜）

本目录是微信小游戏「开放数据域」（子域）工程，入口为 `index.js`（docs/05 §4.3）。

## 运行机制

- 主域桥：`assets/scripts/ui/platform/wechat/WechatFriendRank.ts`
  - `render({ top, title })` → `wx.getOpenDataContext().postMessage({ type: 'render', top, title })`
  - `hide()` → `postMessage({ type: 'hide' })`
- 开放域收到 `render` 后调用 `wx.getFriendCloudStorage({ keyList: ['bestScore'] })`，
  将好友榜绘制到共享画布（sharedCanvas）；`bestScore` 由主域成绩提交时经
  `wx.setUserCloudStorage({ KVDataList: [{ key: 'bestScore', value: String(score) }] })` 写入。
- 主域仍需把 sharedCanvas 作为纹理/节点显示出来（当前排行榜面板消费云端数据，
  好友页签暂降级为世界榜；共享画布 UI 接入点已在 `WechatFriendRank` 预留）。

## Cocos 构建配置（一次性，编辑器内）

1. 打开「项目 → 构建发布」→ 平台选 `wechatgame`；
2. 在构建选项中找到「开放数据域代码目录」/「Open Data Context」（3.8.x 位于构建面板高级选项），
   填写 `assets/openDataContext`（相对项目根目录）；
3. 构建产物 `build/wechatgame/openDataContext/index.js` 会包含本目录内容，
   且 `game.json` 自动写入 `"openDataContext": "openDataContext"`（以编辑器实际产物为准）；
4. 微信开发者工具导入 `build/wechatgame` 后，在控制台确认：
   - `wx.getOpenDataContext` 可用（主域）；
   - 排行榜共享画布区域能绘制好友数据（需真机/体验版，开发者工具关系链数据为模拟数据）。

## 本地/编辑器降级

- 非微信环境：`WechatFriendRank.render/hide` 返回 false，不抛异常；
- 微信但未配置/未构建开放数据域：主域 `getOpenDataContext()` 可能返回 undefined，同样安全降级；
- 云端排行榜（世界榜）始终可用，不依赖本目录。
