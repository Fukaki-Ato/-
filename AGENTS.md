# 工作区入口

先读 README；仅按任务加载专题文档，不必通读 `docs/`。

## 开工顺序

1. `git status --short`：保留已有修改/删除，不假定工作区干净。
2. 环境：推荐 Node 24；依赖用根目录 `npm ci`，不改锁文件来绕过安装问题。
3. 查看目标源码、调用方和测试；`dist/`、`build/`、`*.tsbuildinfo` 是生成物，不手改。
4. 普通逻辑改动跑 `npm test -- tests/<name>.test.mjs`；交付前跑 `npm run check`。
   Web 集成还需 `npm run build:web` 和实际浏览器验证；WX 构建不能代替开发者工具/真机验证。

## 去哪里改

- 模拟/配置/效果：`packages/game/src/core`、`config`、`schema`。
- 游戏渲染/流程/页面：`packages/game/src/{render,flow,ui}`。
- 浏览器/DOM：`apps/web/src`；WX API：`apps/wx/src/platform`。
- 通用 UI/平台契约：`packages/framework/src`；公共 API 修改需维护者评审。
- 边界与 Cocos 方向：`docs/architecture.md`；环境/故障：`docs/development.md`。

## 不变约束

- 依赖 `apps → game → framework`；共享包不使用浏览器/WX 全局，不反向导入 app。
- `core` 不依赖 Three.js，不用 `Math.random`；玩法随机使用 `RunRng`。
- `apps/*/src` 和 `packages/*/src` 的 TS 源文件最多 300 行；玩法数值放配置。
- 效果 primitive 同步引擎、schema 枚举与测试；golden 仅在确认行为变化后更新。
- 改自绘 UI 文案时核对字体覆盖，操作见 `assets/fonts/README.md`。
- 不把历史文档中的分支状态、测试数、包体数据当作当前结果；以代码和实际检查为准。
- 协作角色/PR 规则以 `CONTRIBUTING.md` 为准，不直接推 `main`。

当前边界：Web 可玩且商店只读；WX 已接主流程、任务/手册、确定性消费/出战/主题云逻辑及九角色/补给/海湾与首发页面美术，多页离线观察通过；真实云/开发者工具/真机视觉与性能仍未验收。不要把 Web、离线图或 bundle 检查通过写成 WX 已验收。
