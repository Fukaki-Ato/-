# 微信小游戏运行时实测记录（2026-09-30）

> 用途：issue #6「WX 场景与主题资源前置对接」的验收证据 + 后续 WX 测试的参考基线。
> 环境：微信开发者工具 Stable **1.06.2504060** / 基础库 **3.17.2** / Windows 10 x64 /
> 真机小游戏 AppID（本仓 `apps/wx/project.config.json`）。
> 所有结论均为**模拟器内实测**或**本地 Chrome 闭环复现**取得，非文档推断。

## 一、结论速查表

| # | 结论 | 严重度 | 状态 |
| --- | --- | --- | --- |
| 1 | three.js 把微信的 WebGL2 上下文**误判成 WebGL1** | 阻断级 | 已定位 + 已修（未提交） |
| 2 | `wx.requestAnimationFrame` 不存在（rAF 在 GameGlobal 上） | 阻断级 | 已定位 + 已修（未提交） |
| 3 | `game.json` 的 `iOSHighPerformance` 会让 Windows 模拟器 jsbridge 永远起不来 | 阻断级 | 已定位，待决策 |
| 4 | 分包里的 `config/game.json` 读不出来（其余 7 个正常） | 中 | 已定位，待改名验证 |
| 5 | 单测 mock 与代码犯同一个错 → `npm test` 全绿也抓不到 1/2 | 中 | 待补断言 |
| 6 | 工程类型在开发者工具里**导入时定死**，之后会回写 `compileType` | 操作坑 | 已记录 |
| 7 | 游客模式下 CLI 只能打开小程序工程，打不开小游戏工程 | 操作坑 | 已记录 |

## 二、逐条详情

### 1. three.js 误判 WebGL 版本（影响最大）

**现象**：`MeshStandardMaterial`（地面/路面）不渲染、`InstancedMesh` 全部拒绘；Console 以约
**1 万条/秒**刷下面两类消息，4 分钟累计 230 万条，把调试器面板撑到 **3.7 GB** 后 OOM：

```
THREE.WebGLRenderer: ANGLE_instanced_arrays extension not supported.
THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but
  hardware does not support extension ANGLE_instanced_arrays.
WebGL: INVALID_OPERATION: useProgram: program not valid
```

**探针实测的运行时真实能力**：

```
typeof WebGL2RenderingContext = undefined          ← 微信没暴露这个全局类
typeof WebGLRenderingContext  = function
webgl2 -> OK | VERSION=WebGL 2.0 (OpenGL ES 3.0 Chromium) | GLSL=WebGL GLSL ES 3.00
webgl  -> null        experimental-webgl -> null      ← 微信只给 WebGL2
gl.constructor.name = WebGL2RenderingContext          ← 构造器名字本来就是对的
扩展 21 个，全是 WebGL2 原生扩展；OES_standard_derivatives / ANGLE_instanced_arrays /
OES_vertex_array_object / EXT_blend_minmax 均不在列表 —— 因为在 WebGL2 里它们是核心功能
```

**根因**：three r160（`node_modules/three/build/three.module.js`，WebGLCapabilities）的判定是

```js
const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined'
  && gl.constructor.name === 'WebGL2RenderingContext';
```

第一个条件在微信里恒为 false → three 走 WebGL1 分支 → ① 按 GLSL ES 1.00 + `#extension
GL_OES_standard_derivatives` 生成 PBR 着色器（WebGL2 无此扩展名 → 编译失败，编译器原话
`ERROR: 'dFdx' : no matching overloaded function found`）；② 去要 `ANGLE_instanced_arrays`
（WebGL2 里是核心功能、不列为扩展 → 拒绘）。

**所以微信的 WebGL 一点都不残缺，是 three 看错了。**

**修法**（`apps/wx/src/platform/canvasFactory.ts`，在建 renderer 前补全局）：

```ts
function exposeWebGL2Class(canvas: GLCanvas): void {
  const g = globalThis as { WebGL2RenderingContext?: unknown };
  if (g.WebGL2RenderingContext !== undefined) return;
  const ctx = (canvas as unknown as { getContext(k: string): { constructor: Function } | null })
    .getContext('webgl2');
  if (ctx) g.WebGL2RenderingContext = ctx.constructor;
}
```

**验证**：
- 本地 Chrome 闭环：删全局 → `isWebGL2=false`、548 条与微信逐字相同的报错；用 `gl.constructor`
  补回 → `isWebGL2=true`、**0 条日志**。
- 微信模拟器：补回后 `typeof WebGL2RenderingContext=function`、`instanceof WebGL2=true`。

### 2. `wx.requestAnimationFrame` 不存在

小游戏的 `requestAnimationFrame` / `cancelAnimationFrame` 是 **GameGlobal 上的全局函数**，
不在 `wx` 对象上。`apps/wx/src/platform/wxPlatform.ts:48` 原调 `wx.requestAnimationFrame` →
`TypeError: t.requestAnimationFrame is not a function`，渲染循环完全起不来（画面纯黑、
`__trWx` 未定义）。已改为优先取全局、取不到才回落注入的 `wx`。

### 3. `iOSHighPerformance` 卡死 Windows 模拟器

`apps/wx/game.json` 带 `"iOSHighPerformance": true` 时：屏幕纯黑、`game.js` **一行都不执行**、
Console 只有 `[jsbridge] invoke getSystemInfo fail: jsbridge not ready`（栈顶是 WAGame 自己读
`deviceOrientation`）。删掉该字段后 `game.js` 立刻跑起来。

**待决策**：该字段是 iOS 真机高性能模式声明，删了影响真机表现，不删则 Windows 模拟器完全无法调试。
建议由运行时负责人定（可考虑构建时按目标平台生成不同 `game.json`）。

### 4. 分包里的 `config/game.json` 读不出来

```
ok=false | 文件数=7 | errors=["game: 网络与缓存均不可用"]
sources={characters,skills,items,obstacles,themes,events,economy = "network", game:"failed"}
```

注：`configLoader.ts:19` 的 `'network'` 只是标签名，WX 侧指向 `extras.readJson` →
**那 7 个 config 确实是从 `pkg-assets/config/` 分包读出并通过 schema 校验的**，
即 #6 要的「资源可读取」证据成立。

失败的那个文件本身没毛病（3959 B、无 BOM、JSON 合法、与其余 7 个同格式），
怀疑撞了微信平台保留名 `game.json`。**待验证的修法**：分包落地时起别名（如 `gameplay.json`）。

→ **#6 内容方案应写入一条命名约束：分包内资源不得与平台保留名同名。**

### 5. 测试盲区

`tests/platform-wx.test.mjs:47` 与 `tests/wxbuild.test.mjs:23` 的 mock 把
`wx.requestAnimationFrame` 当成真 API 来 mock，**与代码犯了同一个错** → 第 1、2 条单测一条都抓不到。
`tools/check-wx-size.mjs` 的门禁只量体积与文件布局，同样抓不到第 1、2、3、4 条。

建议补两条断言：① 适配器取 rAF 时优先全局；② 建 renderer 前 `WebGL2RenderingContext` 已暴露。

## 三、当前包体基线（未压缩字节，门禁 主包 4 MB / 整包 30 MB）

| 包 | 体积 | 占比 | 说明 |
| --- | --- | --- | --- |
| main | 490 KB | 12.0% | 其中 three 占 467 KB |
| pkg-assets | 3.15 MB | 10.3% | 其中音频 2.18 MB（run.mp3 1.52 + death.mp3 0.66）占分包 69% |
| 合计 | 3.64 MB | — | |

## 四、WX 测试操作要点（避坑）

1. **工程类型在导入时就定死**。若项目列表里那条记录是"小程序"，工具会**回写**
   `apps/wx/dist/project.config.json` 把 `"compileType": "game"` 改成 `"miniprogram"`，
   之后所有报错（找不到 `app.json`、`o.pages is not iterable`）都是这个引起的，与代码无关。
   解法：在项目首页删掉该记录（只删记录不删文件）→ 重新导入并选「小游戏」。
2. **游客模式（未登录）下 CLI 打不开小游戏工程**：工具内部有两个游客 AppID
   （小程序 `touristappid` / 小游戏 `wx6ac3f5090a6b99c5`），而 CLI 的 `getAppInfo`
   只对前者短路，其余一律打服务器要权限 → 必然 `INVALID_LOGIN`。
   真登录 + 真实 AppID 后 `cli open` 可用。
3. **调试器面板崩了（哭脸）先查进程**：关掉窗口后 `wechatdevtools.exe` 常整批残留，
   实测有一个吃 3.7 GB。`taskkill -F -IM wechatdevtools.exe` 全清后重启才有效。
4. **小游戏模式下 Console 不能求值**（`Expression not available`），`top` 也不是游戏上下文。
   要读运行时数据，只能让游戏自己 `console.log`，或用 `wx.request` POST 回本机（本次取证即此法）。
5. **改过 `config/*.json` 后要先「清缓存 → 全部清除」**：装载链会把 config 缓存进 storage。
6. 不要把 `*.bak` 之类备份放进被导入的工程目录（会被算进包体）。

## 五、WX 端目前的能力边界（给内容方案用）

| 能力 | 实测结论 |
| --- | --- |
| WebGL2 上下文 | ✅ 提供（但需第 1 条修复，three 才认） |
| `MeshBasicMaterial` / `Lambert` / `Phong` | ✅ 可用 |
| `MeshStandardMaterial` / `Physical`（PBR） | ⚠️ 依赖第 1 条修复；修复后应可用，待复测 |
| `ShaderMaterial`（自写 GLSL ES 1.00） | ✅ 可用（海滨天空穹顶着色器本身无问题） |
| `DataTexture`（程序化纹理） | ✅ 可用 |
| `InstancedMesh` | ⚠️ 依赖第 1 条修复；修复后应可用，待复测 |
| 分包 `wx.loadSubpackage` + 包内文件读取 | ✅ 可用（7/8 config 实测读到） |
| 平台保留名（`game.json`）作分包资源 | ❌ 读不出来 |
| `EXT_blend_minmax` / `OES_*` 等 WebGL1 扩展 | ➖ 不存在（WebGL2 已核心化），three 修复后不再索取 |
