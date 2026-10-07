# BG1 背景框架与模式 完成报告

> 实验背景：主界面动态背景方案对比（static / parallax / video）。本会话交付背景结构框架层；BG2（视差实现）、BG3（切带校准）、BG4（Web 视频外壳）、BG5（测量）为并行会话，主会话统一合并验收。
>
> 工作目录：`.worktrees/BG1`（分支 `sess/BG1`）；提交：`5ec9412`（代码）＋本报告提交。未 push。

## 改动清单

### 新增

| 文件 | 用途 |
| --- | --- |
| `assets/scripts/ui/panels/MainMenuBackground.ts` | 背景框架层：`BackgroundMode` / `resolveBackgroundMode()` / `createMainMenuBackground(parent, mode)`；`fallback`（三段色块）与 `image`（底图）独立子树；`BackgroundTicker` 私有组件驱动视差；video 模式相机清屏色 alpha 置 0 / dispose 恢复 |
| `assets/scripts/ui/panels/MainMenuBackground.ts.meta` | 复制 `Theme.ts.meta` 模板，新 uuid `6969631f-ece4-4c5d-8392-ea7df6bd8aea` |

### 修改

| 文件 | 原因 |
| --- | --- |
| `assets/scripts/ui/panels/MainMenuPanel.ts` | `buildBackground()` 改为调用 `createMainMenuBackground(this.node, resolveBackgroundMode())` 并保存句柄；面板节点 `NODE_DESTROYED` 时 `dispose()`（场景切换 / `UIRoot.reset` 均覆盖）。移除已迁出的 `BG_SKY/BG_SEA/BG_SAND` 常量，其余未动 |

未修改其他文件；`ParallaxLayers.ts` 冻结签名未动（仅按值导入 `createParallaxLayers`、按类型导入 `ParallaxHandle`）。额外导出了 `MainMenuBackgroundHandle` 接口（冻结要求 `{ dispose(): void }` 的命名版，不改变签名）。

## 背景结构（冻结接口实现口径）

- 根节点 `Background`（750×1624、`stretch`，挂面板节点下）拆两棵独立子树：
  - `fallback`：`Graphics` 三段色块，颜色与矩形参数沿用原 `buildBackground`（BG_SKY `rect(-375,100,750,4000)`、BG_SEA `rect(-375,-430,750,530)`、BG_SAND `rect(-375,-4000,750,3570)`）；
  - `image`：`applySprite(bgMain)` 全屏、透明占位色；image 位于 fallback 之后（渲染在上，图加载成功自然遮住色块，失败保留色块）。
- `static`：创建 `fallback` + `image`。
- `parallax`：同 static；`loadSprite(bgMain)` 成功且 `texture instanceof Texture2D` 后，用 `frame.texture`（尺寸取 `textureSize`）调用 `createParallaxLayers(Background 根节点, { texture, textureSize, designSize: 750×1624 })`；`BackgroundTicker` 随根节点挂载，`update(dt)` 转发，组件 `onDestroy` / dispose 时停止并释放句柄（幂等，不会双释放）。
- `video`：不创建 `fallback`/`image`（无渲染内容）；沿父链找到 Canvas，将其相机（场景 `_clearFlags=7`、`_color=(78,195,247,255)`）的 `clearColor` 改为原 RGB + alpha 0；未找到相机仅 warn，不影响句柄可用性。
- `dispose()`：停止/释放视差 → 恢复相机原 `clearColor` → 销毁 `Background` 根节点；重复调用安全。

## 模式解析规则（`resolveBackgroundMode`）

| 输入（web） | 返回 |
| --- | --- |
| `?bg=video` | `video` |
| `?bg=parallax` | `parallax` |
| `?bg=static` | `static` |
| 缺省 / 空 search | `static` |
| 非法值（如 `?bg=fast`） | `static` |
| 多参数（如 `?x=1&bg=video`） | `video` |
| 非 web 平台（`sys.isBrowser=false`） | `static` |
| `location` 缺失 / 访问抛异常 | `static` |

实现：`sys.isBrowser` 守卫 → `URLSearchParams(location.search).get('bg')` 精确匹配 `parallax` / `video`（区分大小写，与 BG4/BG5 的 `?bg=<mode>` 口径一致），全部逻辑包在 try/catch 内。

## 验证结果

- **基线**：改动前 `npm run check` 通过（typecheck:core + typecheck:cc + vitest 31 文件 199 用例）。
- **最终**：`npm run check` **全绿** —— `typecheck:core` 通过、`typecheck:cc` 通过、`vitest run` 31 文件 199 用例全部通过（无新增/失败用例）。
- **临时用例核对 `resolveBackgroundMode`**（`tests/tmp-bg1-resolve.test.ts`，mock `cc`：`Color`/`Component`/`sys`/`isValid`）：上表 9 种输入全部断言通过（9/9）；核对完毕已删除，未进入提交。
- 未运行 Cocos 构建、未改动 `build/`、`dist/`。真实渲染效果依赖主会话合并 BG2–BG5 后在构建产物上目测。

## 遗留问题 / 需要人工验证

1. **视差真实效果待验证**：BG2 当前为占位空实现，`createParallaxLayers` 的真实条带滚动需 BG2 合并、主会话构建后目测（update 驱动链路由本会话 `BackgroundTicker` 保证）。
2. **video 模式仅 web 实验用**：微信端无 DOM 视频对应实现；且画布透出还需 BG4 的引擎透明画布宏 + 外壳视频，缺一不可。相机 alpha 归零解决的是「相机清屏色盖住视频」这一层。
3. **素材现状**：`images/bg/main` 为 1007×1562 带 UI mock，图加载成功会全屏铺满（含 UI）；纯净底图与视差条带校准由 BG3 / 主会话负责。
4. **相机定位**：`findCanvasCamera` 依赖面板处于 Canvas 子树（UIRoot 保证）；若场景结构变化导致找不到，video 模式仅 warn，画布将保持不透明。
5. **编辑器/真机冒烟**：本会话未运行 Cocos 编辑器构建与运行预览，静态/视差/video 三模式的目测验收由主会话统一执行。

## 验收自检（提示词 §6）

- [x] `npm run check` 全绿（typecheck:core + typecheck:cc + 单测）。
- [x] `resolveBackgroundMode` 对 `?bg=video`、`?bg=parallax`、缺省、非法值、非 web 环境的返回值：用临时 vitest 用例逐条实测通过（见上）。
- [x] 仅改动提示词列出文件；未 checkout/merge/rebase/push；未碰主目录与其他 worktree。

## 契约偏差

- 无。`ParallaxLayers.ts` 签名未改；`BackgroundMode` / `resolveBackgroundMode` / `createMainMenuBackground` 与冻结接口一致（`createMainMenuBackground` 返回命名接口 `MainMenuBackgroundHandle`，结构等价）。
