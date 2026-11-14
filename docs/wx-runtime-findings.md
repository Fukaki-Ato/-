# WX 运行时：历史发现与待复测

历史测试环境（2026-09-30）：Windows 10、开发者工具 Stable 1.06.2504060、基础库 3.17.2。
结论来自当时模拟器/本地 Chrome，不是真机验收，也不保证其他版本相同。2026-11-06 入口已改为共享主流程，见 [apps/wx/README.md](../apps/wx/README.md)；本次接线未关闭下列历史目标环境问题。

## 已有代码与测试

| 历史问题 | 当前实现 / 自动覆盖 |
| --- | --- |
| three r160 因缺 `WebGL2RenderingContext` 全局误判 WebGL2 为 WebGL1，PBR/实例绘制失败 | `platform/canvasFactory.ts` 创建主画布时，从实际 webgl2 context 补构造器；`tests/platform-wx.test.mjs` 已覆盖 |
| rAF 位于 GameGlobal，不在 `wx` 对象 | `platform/wxPlatform.ts` 优先全局 rAF/cancel，回退注入 wx；同一测试已覆盖优先级 |

代码和 mock 检查通过不证明修复后的 PBR/InstancedMesh 在当前开发者工具和真机都正确；仍需目标环境复测。

## 尚未关闭的目标环境问题

- **高性能声明**：历史 Windows 模拟器中 `iOSHighPerformance: true` 导致 jsbridge 未就绪、入口未执行；去掉后可运行。目前 `apps/wx/game.json` 仍保留 `true`。需要运行时负责人决定策略并复测；不要为了模拟器擅自改变真机声明。
- **分包配置**：历史 7/8 配置可读，`pkg-assets/config/game.json` 失败。怀疑保留名冲突，但**没有证明根因**，也没有完成别名方案。当前构建和入口仍使用原文件名；mock 文件读取测试不能关闭此问题。
- 完整游戏流程与共享 renderer UI 已有接线和 Node 行为检查；目标端资源/音频/像素渲染仍未完成整体验收。

## 复测顺序

1. `npm run check`，再 `npm run build:wx -- --minify`；体积以本次输出为准，不沿用历史 3.64/8.89 MB。
2. 导入 `apps/wx/dist`，确认工程类型是**小游戏**（`compileType: game`）。旧导入记录若是小程序，先从项目列表移除记录，不删除源码，再正确导入；工具可能回写产物中的 project config。
3. 记录开发者工具、基础库、OS、登录/AppID 条件；游客模式不等于真实 AppID 的权限测试，历史游客 CLI 打开小游戏曾失败。
4. 检查 `[tr-wx] game flow ready select` 与实际大厅出现，并验证 8 份配置、模型/音频加载。旧空壳的 `__trWx` 探针和定时刷屏日志已移除；启动失败应查看原生提示或启动页错误，不套用旧探针命令。
5. 配置复测前按需清工具/storage 缓存，避免缓存掩盖读取错误。不要在导入产物内放备份文件，体积门禁会计入。

出现黑屏先分清入口是否执行、渲染器是否误判、工程类型是否正确；不要以全绿 Node 测试替代这些运行时检查。
历史调试器曾因刷日志内存暴涨；先正常关闭并检查残留进程，不照抄批量强杀命令。
