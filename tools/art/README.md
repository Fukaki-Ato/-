# 离线美术管线

这些工具生成真正的蒙皮网格、关键帧和可编辑 Blender 工程，不建设 Web 测试站。
离线 Cycles 图用于检查造型和姿态；它不是微信 Three.js 像素或设备性能验收。

## 工具环境

本次使用免费 Blender **4.5.15 LTS** 官方 Linux 发行包，下载后核对官方 SHA256。
[官方发行目录与校验文件](https://download.blender.org/release/Blender4.5/)。
当前隔离安装位于 `/tmp/opencode/thunder-art-r4-PYOEaG/blender/`，没有更改系统包或项目 npm 依赖。
首次启动缺 libSM/libICE/libGL；默认 Ubuntu 镜像返回 502 后，改从 Ubuntu 官方 archive
下载同版本包、按 apt 元数据 SHA256 核验，解压到隔离 `libs/` 后运行。

```sh
export LD_LIBRARY_PATH=/tmp/opencode/thunder-art-r4-PYOEaG/blender/libs/usr/lib/x86_64-linux-gnu
B=/tmp/opencode/thunder-art-r4-PYOEaG/blender/blender-4.5.15-linux-x64/blender
```

其他机器可直接使用本地同版本 Blender；不依赖这个临时安装路径。软件许可随官方发行包提供，
使用 Blender 不解决输入素材的权利核实问题。

## 角色重建与观察

```sh
# 原5角色：输入原GLB，输出新coastal GLB与可编辑blend；原文件不覆盖。
"$B" -b -t 2 --python tools/art/refine_character.py -- bball
# 可选 bball / frog / pony / niu / whale

# 四名原创角色：手写截面拓扑、服饰、骨架和动作，无第三方人物模型。
"$B" -b -t 2 --python tools/art/new_roster.py -- ama
# 可选 ama / kaze / rina / bolt；不传ID时顺序生成四名。

# 查看实际导出的GLB，而不是仅渲染导出前的工程。
"$B" -b -t 2 --python tools/art/render_character.py -- \
  assets/characters/coastal/ama.glb /tmp/opencode/ama-observation.png Run 0.2 45 512

# WX肖像同样来自真实GLB，最后的portrait参数输出3:4透明PNG。
"$B" -b -t 2 --python tools/art/render_character.py -- \
  assets/characters/coastal/ama.glb assets/ui/portraits/char_ama.png Idle 0.4 12 384 portrait
```

`render_character.py` 参数：输入、输出、clip、秒数、绕角色观察角度、宽度、可选 portrait。
正面为 Blender +Y / glTF −Z；原 bball 的 +Z 历史朝向在新输出中校正。
输出仅写入任务拥有的 `assets/characters/coastal/`、`art-source/coastal/` 和明确指定的图像路径。
重跑脚本会覆盖这些输出；手工修改 blend 后请另存或直接导出，避免被重建覆盖。

`refine_mesh.py` 负责拓扑/服装、局部减面、蒙皮裙摆和常量材质顶点色合批。
`refine_motion.py` 按实际骨长制作接地/收腿跑步和无缝待机，保留其余动作；导出
`thunderMotionVersion=2` 使运行时跳过旧临时摆幅放大。导入的24fps和原创30fps按各自时间基准处理。
新旧角色的技能、体量配置和碰撞净空不在这些工具中修改。

## 场景

`coast_snapshot.mjs` 从实际 TS 几何/实例生成离线快照，`coast_render.py` 用 Cycles 近似观察。
原源码备份、前后图与几何预算见
[`COAST-ART.md`](../../docs/goals/wechat-release-2026-11-06/COAST-ART.md)。
海面 GLSL、Toon 分档、透明排序和设备显存/帧耗仍须微信端验收。

## 补给与页面

`pickup_assets*.py`原创六件轻量PBR补给和可编辑工程，见`art-source/pickups-coastal/README.md`。
首次默认生成会拒绝覆盖，重建已拥有输出需显式`--replace-owned`；掉落表与玩法数值不由资产工具修改。
另有`coastal_magnet.py`原创U形磁铁及可编辑源，沿原尺寸/零中心/spin契约；它替换当前WX配置的旧磁铁来源，旧文件留历史不分发。

同源自绘页面可经`ui_snapshot.mjs / ui_render.py / ui_probe.py`离线软件OpenGL捕获，
加载真实字体和portrait并编译实际shader，无Web站；命令、隔离环境与证据边界见[`ui_README.md`](ui_README.md)。
默认字体现与WX一致为`assets/fonts/noto`；重建来源和精确UV/基线约定见`assets/fonts/noto/README.md`。

## 检查

```sh
npm test -- tests/refined-avatar-assets.test.mjs tests/new-roster-assets.test.mjs \
  tests/coast-art.test.mjs tests/coastal-pages.test.mjs tests/wx-runtime.test.mjs
```

这些检查覆盖真实骨架/蒙皮、动作闭环、120Hz渲染与60Hz模拟关系、换道相位、资源分包和导航。
保留原GLB测试，区分旧资产回归与新资产交付。最终仍需根级 `npm run check`、WX/云函数构建，
以及独立的微信开发者工具、真机和真实云验收。
