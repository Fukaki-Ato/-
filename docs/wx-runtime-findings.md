# WX 运行时：历史发现与待复测

历史测试环境（2026-09-30）：Windows 10、开发者工具 Stable 1.06.2504060、基础库 3.17.2。
结论来自当时模拟器/本地 Chrome，不是真机验收，也不保证其他版本相同。入口已改为共享主流程，见 [apps/wx/README.md](../apps/wx/README.md)。

## 已有代码与测试

| 历史问题 | 当前实现 / 自动覆盖 |
| --- | --- |
| three 因缺 `WebGL2RenderingContext` 全局误判 WebGL2 为 WebGL1，PBR/实例绘制失败 | `platform/canvasFactory.ts` 从实际 webgl2 context 补构造器；`tests/platform-wx.test.mjs` 覆盖 |
| rAF 位于 GameGlobal，不在 `wx` 对象 | `platform/wxPlatform.ts` 优先全局 rAF/cancel，回退注入 wx；同一测试覆盖优先级 |
| `iOSHighPerformance: true` 令历史 Windows 模拟器 jsbridge 未就绪 | `build-wx.mjs` 默认剔除；`TR_WX_IOS_HP=1` 保留，`tests/wxbuild.test.mjs` 覆盖两种产物策略 |
| 历史 7/8 配置可读，分包 `config/game.json` 失败，疑似保留名冲突 | 构建期改名 `gameplay.json`，`bootstrap.ts` 同步映射；构建测试与 `tests/wx-runtime.test.mjs` 覆盖别名一致性 |

2026-11-13 整合保留了主线的构建修正，并将原先位于旧空壳入口的配置映射移入完整流程启动器。代码和 mock 检查不证明当前开发者工具及真机表现，保留名根因也仍需目标环境确认。

## 尚未完成的目标环境验收

- 完整流程、共享 renderer UI、模型/音频和 PBR/InstancedMesh 的实际显示及性能。
- 默认高性能字段策略与别名读取在当前开发者工具、基础库、iOS/Android 真机上的复测。
- CloudBase 环境配置、真实部署、身份/结算/任务/商城闭环；Node 测试不等于真实云验收。

## 复测顺序

1. `npm run check`，再 `npm run build:wx -- --minify`；体积以本次输出为准，不沿用历史数值。
2. 导入 `apps/wx/dist`，确认工程类型是**小游戏**（`compileType: game`）。旧导入记录若是小程序，先移除记录，不删除源码，再正确导入；工具可能回写产物中的 project config。
3. 记录开发者工具、基础库、OS、登录/AppID 条件；游客模式不等于真实 AppID 的权限测试，历史游客 CLI 打开小游戏曾失败。
4. 检查 `[tr-wx] game flow ready select` 与实际大厅，验证 8 份配置、模型/音频加载。旧空壳的 `__trWx` 探针和定时日志已移除；启动失败查看原生提示或启动页错误。
5. 配置复测前按需清工具/storage 缓存，避免缓存掩盖读取错误。不要在导入产物内放备份文件，体积门禁会计入。

黑屏时区分入口是否执行、渲染器是否误判、工程类型是否正确。历史调试器曾因刷日志内存暴涨；先正常关闭并检查残留进程，不照抄批量强杀命令。
