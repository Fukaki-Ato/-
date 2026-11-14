# 主界面维护入口

本页取代 issue #12（2026-10-04）的分支交接清单。旧分支“未推”、测试数、包体和审批状态不是当前事实；历史细节查 Git 历史，不作为当前验收。

## 当前行为

- `flow/mainFlow.ts` 启动完成进入 `select`（大厅），游客态，无强制登录。
- Web 通过 `apps/web/src/bootstrap.ts` 注入 DOM 大厅、选角、商店、设置、结算和 HUD；角色入口打开选角页，开始按钮使用已记忆角色进局。共享 canvas UI 保留回退实现，不能与 Web 默认页面混为一谈。
- 设置已接通：只切换场景主题，下一局生效。商店已接通：可分类/分页浏览，**不购买、不兑换**。
- 活动、任务、成就、排行榜、仓库、福利手册等尚未实现；Web 移动大厅点击显示准备中提示，共享 canvas 回退入口仍为空操作。档案组件在仓内，但没有大厅入口。
- Web 移动入口设置 `menuArt: false`，跳过旧视频/徽标图集预载（部分徽标仍作为 DOM 图片使用）。旧壳默认保留视频→静态图回退和离开大厅暂停逻辑；不是当前 Web 默认背景。WX 入口未接主界面，不能把素材已打包写成页面已运行。

## 改动位置

| 责任 | 文件（相对 `packages/game/src`，除特别注明） |
| --- | --- |
| Web 大厅/响应式布局 | `apps/web/src/mobileLobby.*`、`mobileUi.*`（详见 [mobile-ui.md](mobile-ui.md)） |
| 共享 canvas 大厅回退 | `ui/menuLayout.ts`：1024×1536 设计基准；`ui/lobbyView.ts`、`ui/badges.ts` |
| 页面选择/入口接线 | `ui/overlayViews.ts`、`flow/mainFlow.ts`、`apps/web/src/bootstrap.ts` |
| 主题设置 | `flow/settingsScene.ts`、`ui/settingsView.ts` |
| 背景贴图/循环接缝 | `ui/menuBackdrop.ts`；视频加载/可见性在 `apps/web/src/uiShell.ts` |
| DOM 页面/清理 | `apps/web/src/{characterSelectOverlay,shopOverlay,mobilePanels,mobileHud,mobileUi}.ts` 与 CSS |

测试：`menu-layout`、`menu-backdrop`、`pages`、`mainFlow`、`settings-scene`、`shop-navigation`、`shop-view`、`mobile-renderers`、`mobile-ui` 对应的 `tests/*.test.mjs`。
运行 `npm run check`、`npm run build:web` 后，在浏览器确认窄高屏/横屏、选角→进局→结算、商店返回；只有修改旧背景路径时才复测视频回退。自动测试不证明 WebGL/视频实际显示。

## 素材与渲染注意

- Python 脚本使用独立环境，依赖见 [development.md](development.md)。`backdrop_clean.py` 输出的是 `tools/badge_matte_src/menu-bg.png` 和草稿，**不是**运行时背景的可复现生成器。
- `cut_start_plaque.py` / `cut_menu_badges.py` 输出 `assets/ui/badges/{normal,glow}/`；glow 从 normal 合成，避免帧间跳位。输入源在 `tools/badge_matte_src`；重跑前检查脚本路径和预期 diff。
- 背景视频源片在仓外，无完整可重跑配方；已有 mp4/jpg 是运行时输入。不要承诺仅靠仓库即可再生成源视频。
- `ImageBitmap` 与视频的上传翻转不同；现有 `menuBackdrop` UV 和视频 `flipY=false` 配套，避免重复翻转。标准材质贴图需标 sRGB；three `alphaMap` 读取绿通道。
- 背景挂在 `host.overlay.scene`，时间走页面 `frame` 生命周期；不另建帧循环。
- WX 构建仅复制 UI PNG，不复制 mp4/jpg；完整主界面集成和目标端动效仍待实现。
