# 第4轮海滨场景独立美术切片

范围：`packages/game/src/render/coast/**`、本页、新增的 `tools/art/coast_*` 与 `tests/coast-art.test.mjs`。

## 基线与观察方法

已读工作区 AGENTS、README、CONTRIBUTING、BASELINE、ART-HANDOFF、coast 全部源码、`konbini/kit.ts`、`trackVisuals.ts`、`cameraRig.ts` 和 runnerScene 的相机/灯光/释放调用方。

**修改前真实拷贝**：`/tmp/opencode/coast-art-r4-4jWM5s/coast-before/`。保留原 dirty 工作区，没有读取或写入副本工作树。

先通过 esbuild 直接加载当前 TS，从实际 `createCoastProps` / `createTrackVisuals` 导出顶点、索引、线性顶点色、实例矩阵、实例色，再由 Blender 4.5.15 LTS / Cycles CPU、2 线程离线观察。基线图已在开始修改 coast 前读图观察。

- 原始观察：左海、右侧奶白玻璃别墅与暖沙关系明确；海面远侧缺少海湾轮廓，近/中景主要是同一条沿岸陈列，木质生活构件不足。
- 跑局机位读取源码地面目标：`(0, 2.7, 8.4)`，注视 `(0, 0, -9.5)`，垂直 FOV 55°、far 160；未改相机。
- 展示机位为离线额外检查机位，不进入游戏。最终展示/细节图关闭离线雾近似以便检查构件；跑局图保留 22–120m 雾的近似。
- **所有图均为离线近似，不是真实微信像素**。几何/实例来自实际源码；Toon 分档、海面 GLSL、浅滩、薄雾、光池、地面程序纹理、天空和光照采用 Blender 近似。Cycles 阴影也不代表运行时开启了场景阴影。最终工具补了实例色和天顶/地平线近似，旧基线图与最终图的背景/材质不可用于逐像素差异判定。
- 原始 `sea.ts` 字节未改；运行时继续使用原动态海面、碎光、水线泡沫和浅滩 shader，离线图不能展示这些 GLSL 的真实表现。

## 实质改动

新增 `bay.ts`，全部走原有 body 合并桶，复用原材质：

1. **远景**：两层不规则低矮岛脊、浅色沙唇和奶白小灯塔。固定远景作为慢速视觉锚点，不随近岸整组绕回；灯塔位置依据地面镜头收进可视范围。
2. **中景**：两片独立沙洲，在本岸与外海之间留下蓝水层；两艘双帆小船，几何双面帆与木质舷沿。两座木构遮阳亭位于右侧原别墅/遮阳伞之间空档：张拉布轻垂、梁与檩条分层、分缝木板台面、内置坐凳/软垫/小桌。
3. **近景**：两处小型冲脚台/板架，包含木板、细金属管和双色冲浪板；19 片局部细沙纹，每片五条细曲线，保留大片留白。

大件在花草之前占位；避让同时计算构件半径和 ±200m 周期邻居。保留 `KEEP=4.75`、原右伞 `x=12.1`、别墅和原生活道具摆位，以及每件各自循环的方式。花草在剩余空位重新确定性采样，不塞入别墅、椅子或新设施。没有修改跑道、玩法、配置、其他主题或 UI。

## 几何/批次近似计数

来自实际生成的 **coast 单独场景**；三角形为所有实例展开总和，不含跑道、角色、UI。draw batch 按单 mesh/单 material 计，未模拟裁剪、遮挡、透明排序或 GPU pass，**不是真机 GPU/帧率测量**。

| 指标 | before | after | 差值 |
| --- | ---: | ---: | ---: |
| 常驻几何 / mesh 近似批次 | 27 | 33 | +6 |
| 独立材质 | 9 | 9 | 0 |
| 实例/普通 mesh 展开件数 | 456 | 484 | +28 |
| 展开三角形 | 52,806 | 56,728 | +3,922（约 7.4%） |
| 共享几何存储三角形 | 10,901 | 12,683 | +1,782 |
| 共享几何顶点 | 14,668 | 17,553 | +2,885 |

所有新增构件在构建时合并/实例化，不逐帧创建几何/材质，没有大纹理，没有新增实时阴影。新增实例通过原有矩阵更新通道滚动。`dispose()` 幂等释放所有 coast 实例属性与 toon ramp；几何/材质保持原约定，由 runnerScene 的场景遍历释放。

## 检查与证据

`node --test tests/coast-art.test.mjs`：5/5 通过（直接 esbuild 源码，不依赖 dist/root build）。

- 多个距离、循环接缝与 5km 大步进后的全部低位几何包围盒，均在 `|x|<4.75` 之外；原高空海鸥不属于地面净空。
- 灌木/风动花草、新设施与原别墅/伞椅/长椅，以及新设施之间的周期包围盒不重叠。
- 原右伞 x、200m 整周期、逐件先后绕回、固定远景保持。
- 连续 3 次构建/清理，每次 1,200 帧：对象/几何/材质/实例矩阵缓冲身份及数量稳定；海面时间 uniform 持续更新。
- 实例/ramp 的 dispose 事件、幂等调用，以及调用方几何/材质清理事件全部到达；这验证资源所有权与 JS 资源无增长，不是微信显存/长跑性能验收。
- 新 TS 均不超过 300 行；`git diff --check` 通过；`cmp sea.ts coast-before/sea.ts` 相同。
- 单独对 `coastProps.ts` 及导入依赖执行 `tsc --noEmit --strict --noUnusedLocals --skipLibCheck --target ES2021 --module ES2022 --moduleResolution bundler` 通过（`typecheck-coast.log`），没有 root build；工具 Node 语法与 Python 编译检查通过，Python 缓存位于任务临时目录。

运行记录：`/tmp/opencode/coast-art-r4-4jWM5s/`。初始检索环境没有 rg，已改用 grep。最初计数/渲染使用的 laneWidth=2.6，经核对配置修正为 2.2，保留旧图但以 corrected 基线为布局证据。服务器重启/SIGTERM 和一次 120 秒超时中断过离线渲染，随后只补未完成输出；最初净空测试读取普通 mesh 的未更新 matrix 导致一项假失败，修正测试的 world matrix 后 5 项通过。没有运行 root build/check、Web 测试站或外部模型/付费/云调用。

### 已保留的基线 / 中间观察

- `before-run.png`、`before-exhibit.png`：修改前先观察的实际几何图（初版近似，laneWidth 2.6、无雾近似）。
- `before-corrected.json`、`before-corrected-run.png`、`before-corrected-exhibit.png`：从真实备份重新提取，laneWidth 2.2，补雾近似。
- `after.json`、`after-run.png`、`after-exhibit.png`：与 corrected 基线同一离线近似阶段的前后观察；已看到沙洲/帆船/海湾轮廓，但原灯塔位置靠画面左缘、展示镜头雾较重，随后只把灯塔/岛脊收进画内，并改进离线观察工具。
- `metrics.json`、`tests-second.log`：前后计数与 5/5 检查记录；最终检查记录另存 `tests-final.log`。

### 最终源快照与观察输出

任务输出根：`/tmp/opencode/coast-art-r4-4jWM5s/`。

- `after-final.json`：最终源码、0m / 2s。
- `after-72m.json`：最终源码、72m / 6s，用于查看右侧遮阳亭进入中景。
- `final-after-run.png`：最终源码的地面跑局镜头（0m）。已读图：左侧灯塔与低岛轮廓进入画内，右侧原奶白别墅/伞仍是主体；跑道与两侧净空保留，没有用近景堆满画面。
- `final-after-exhibit.png`：最终全景展示机位，离线去雾。已读图：本岸、独立沙洲、灯塔岛、较远低岛之间有可辨蓝水层；右侧木亭在原设施空档，并未替换别墅。
- `final-after-detail.png`：最终木亭侧景细节机位，离线去雾。已读图：分缝木平台、柱/梁/檩条、轻垂浅色棚布、内置长凳/坐垫和小桌可辨；旁边的原伞与别墅保留，不占跑道。Cycles 地面阴影仅为离线观察帮助，不是游戏新增阴影。
- `final-after-72m-run.png`：前进 72m 后的地面跑局镜头。已读图：木亭进入右侧中景，继续与别墅错开，左侧仍保持海湾/海鸥/棕榈层次。
- `final-after-render.log`、`final-after-72m-render.log`：最终四张图串行完成记录。全景中的沙纹较细，局内实际辨识度仍需微信设备观察，不以离线全景放大替代目标端结论。

复用工具（输出必须为新的任务路径；JSON 独占创建）：

```sh
node tools/art/coast_snapshot.mjs "$OUT/scene.json" 0 2
LD_LIBRARY_PATH=/tmp/opencode/thunder-art-r4-PYOEaG/blender/libs/usr/lib/x86_64-linux-gnu \
  /tmp/opencode/thunder-art-r4-PYOEaG/blender/blender-4.5.15-linux-x64/blender \
  -b -t 2 --python tools/art/coast_render.py -- "$OUT/scene.json" "$OUT/scene" run exhibit detail
```

`coast_snapshot.mjs` 第4个可选参数可指定已保存的 coast 源码目录；仅替换该目录源码，其他调用链仍从当前工作区读取。

## 验收边界

真实微信端连续跑局、shader/透明排序、低端机帧耗/显存和多次进入退出仍待主代理目标端验收。本切片是已落地的场景几何与离线检查成果，不能据此声称微信上线视觉/性能已验收。
