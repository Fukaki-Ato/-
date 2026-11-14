# 海滨竞技俱乐部：首发局内道具

2026-11-06 原创、可复现的六件硬表面 / 运动装备资产。源工程由本仓库 `tools/art/pickup_assets*.py` 的 bpy 几何脚本构建，没有导入外部模型、字体、图片、付费服务或生成式图像。几何 ×2 标志是手写多边形，不依赖字体授权或贴图。这里的原创实现随项目代码使用；既有磁铁和角色输入素材的来源不由此说明覆盖。

## 成品与造型

输出 `assets/pickups/coastal/<name>.glb`；同名 `.blend` 是可编辑源工程。每件只有一个逻辑 mesh，保留可选中的分离几何岛和四类材质面，既便于编辑，也将 glTF 合批限制为四个 primitives。

| 文件 | 设计与可辨结构 | 三角形 | 字节 | glTF 宽 × 高 × 深（米） |
| --- | --- | ---: | ---: | --- |
| shield | 蓝色实心能量核、三道实际球形保护环、绝缘节点、闪电嵌件 | 1700 | 51992 | .646 × .646 × .646 |
| jetpack | 双涡轮、背板及背垫、折叠雷翼、金属喷嘴、暖橙喷口芯与提手 | 1680 | 75536 | .860 × .629 × .270 |
| board | 弧面双翘板、海浪线条、两副桥架、四轮和轴承，紧凑斜摆 | 792 | 41476 | .841 × .677 × .321 |
| multiplier | 双能源币电池、前后几何 ×2 铭牌、金色端盖、提手 | 1064 | 57436 | .620 × .583 × .369 |
| boots | 一对鞋面、鞋带、踝部软垫、缝边、弹性弓形底架、独立底板和胎纹 | 1788 | 74916 | .600 × .531 × .447 |
| helmet | 圆润双壁壳、深色内衬和包边、短帽檐、通风条、铆钉、侧扣及下颌带 | 1596 | 55180 | .632 × .506 × .623 |

六件 GLB 总计 356536 字节。板的 792 三角形略低于建议区间下沿，已包含弧面、双桥、四轮与图案，无需为达到整数门槛堆叠无用面。

Blender 工程使用 Z-up；glTF 导出为 **Y-up，+Z 面向玩家**。所有导出顶点的 AABB 几何中心为 `(0,0,0)`，单位为米。运行时施加 `PICKUP_CENTER_Y` 和现有浮动，不需要再抬高半个模型。板的斜摆已烘焙顶点，自转仍由既有 `model.spin` 决定。全部为标准不透明 PBR：奶白、深海蓝、拉丝金属及每类点色；无纹理、透明、骨架、动画、压缩或其他 glTF 扩展。

## 重建与检查

需要 Blender 4.5 LTS（本次为 4.5.15）。在仓库根目录运行：

```sh
blender -b -t 2 --python tools/art/pickup_assets.py
# 输出已存在时，先核对是本管线所有，再显式覆盖（--names 可仅重建指定物件）：
blender -b -t 2 --python tools/art/pickup_assets.py -- --replace-owned
node --test tests/coastal-pickup-assets.test.mjs
blender -b -t 2 --python tools/art/pickup_assets_render.py -- \
  --output-dir /tmp/opencode/coastal-pickups-review-NEW
```

生成脚本默认拒绝已有输出；不读旧模型。源工程禁用 `.blend1` 备份，避免污染资产目录。`pickup_assets_geometry.py` 提供造型与合批；`pickup_assets_models.py` 保留六种独立构造；`pickup_assets_render.py` **重新导入已交付 GLB**，串行渲染前侧 / 后侧 12 张离线观察图，不以未导出的 bpy 场景代替成品观察。可用 `--names helmet --sides front` 做局部重拍；输出目录需为新路径。

完整渲染结束会用 Blender 自身合成 `contact-front.png` 和 `contact-rear.png` 两张 3×2 观察页，不需要 Pillow / 图像工具安装。页序从左上开始为 shield、jetpack、board / multiplier、boots、helmet。已有完整单图时可加 `--sheets-only` 单独组页；拒绝覆盖已有观察页。

测试用真实 `GLTFLoader.parseAsync` 无 DOM / 无纹理替身加载六件 GLB，检查所有顶点和法线有限、索引有效、实际三角数、中心与三轴体量、材质 / 批次预算、无外部文件与扩展，并检查六份 Blender 源工程。

### 本次离线复核记录

已实际读取六件成品的前 / 后侧两张合成页。第一轮发现并修正了倍率器背面字符镜像（同时将过直的 2 改为带上钩的实心管状几何）、鞋带被鞋面遮住及方形鞋底、头盔通风条翘起的问题；三件局部重建和重拍后再次读图，倍率标志前后可读、鞋带露出、鞋底按脚形收边、通风槽贴合壳面。修正通风条后，边界测试曾检出头盔总高 .49966m；调整下颌带后为 .50563m，保持 .5m 下限并重新通过测试。

最终观察页：`/tmp/opencode/coastal-pickups-review-20261106-c/contact-front.png` 与 `contact-rear.png`；同目录含 12 张单图。该目录复用了未改动三件的前轮成品观察，替换为后三件的最新重拍。原始完整轮为 `...-b`；最早 640px / 24 samples 渲染曾在命令时限中断，后改 512px / 16 samples 串行完成。最终统计：`/tmp/opencode/coastal-pickup-stats.json`；独立测试结果：`/tmp/opencode/coastal-pickup-tests.log`（2/2 通过）。这些临时路径是本次工作环境证据，重建后可重新生成。

## 集成边界

本目录只交付六件资产、源工程、重建工具和独立资产测试。既有 `assets/pickups/magnet.glb` 保留；金币已由 `coinField` 实例几何呈现；钥匙为任务 / 兑换库存，经验卡和皮肤未接首发，不补无用途的占位资产。

实读时 `config/obstacles.json.dropTable.weights` 包含 magnet / boots / helmet / jetpack / shield / board 六类，**未列 multiplier**；`items.json` 已有 multiplier 的局内倍率效果。这里按资产委派交付倍率器，不修改掉落表或玩法数值。主集成负责六条 prefab 路径、远距航标与槽位 / 滞回测试。离线造型和 Node 解析检查不构成微信开发者工具、真机视觉或性能验收。

## 原创 magnet 替代（2026-11-07）

新增 `assets/pickups/coastal/magnet.glb`、可编辑 `magnet.blend` 和独立重建脚本 `tools/art/coastal_magnet.py`。造型从手写截面与路径构建：红蓝双极 U 形、分层倒角、奶白触点和小型陶瓷面销，前后均有真正低于漆面的深蓝绝缘槽。未导入、复制或读取旧磁铁 GLB、其他旧模型或外部素材；无网络模型、下载、字体、贴图或付费服务。这里的原创几何实现随项目代码使用，不覆盖旧输入资产的作者授权。

成品为一个逻辑 mesh、四个标准不透明 PBR 材质 / primitives，**1148 三角形、58340 字节**；无纹理及多余 UV、压缩扩展、灯光、骨架或动画。glTF AABB 尺寸 **0.819600 × 0.700000 × 0.247100 米**，几何中心为零，+Z 面向玩家；背面保持同等可读结构。运行时继续负责 `PICKUP_CENTER_Y` 和 `model.spin`。

```sh
blender -b -t 2 --python-exit-code 1 --python tools/art/coastal_magnet.py
# 默认拒绝已有输出；核对自有输出后显式重建：
blender -b -t 2 --python-exit-code 1 --python tools/art/coastal_magnet.py -- --replace-owned
node --test tests/original-magnet.test.mjs
# 仅重导入交付的新 GLB，串行渲染前后视；目录必须是新路径：
blender -b -t 2 --python-exit-code 1 --python tools/art/coastal_magnet.py -- \
  --review-dir /tmp/opencode/original-magnet-review-NEW
```

Blender 4.5.15、两线程原生命令已执行；默认覆盖被拒绝且 GLB 保持不变，显式重建成功，无 `.blend1` 备份。复建检查最初发现原始立方体自带 UV 的微小浮点差异；移除无用途 UV 后，两次独立重建得到字节一致的 GLB。独立 Node 测试 **2/2 通过**：真实 `GLTFLoader.parseAsync` 无宿主 / 纹理替身解析，验证中心、三轴尺寸、实际面数、有限顶点 / 法线、有效索引、自包含和标准材质预算。

最终交付 GLB 已重新导入，前后视均已实际读图，双极、触点、倒角及绝缘槽完整可辨。观察图：`/tmp/opencode/original-magnet-yx1a9Z/review-final/magnet-front.png` 与 `magnet-rear.png`；测试日志同目录上一级 `test.log`，构建与字节一致性证据为 `repro-final.log` / `repro-result.log`，默认拒覆盖记录为 `refusal.log`。临时路径只记录本次离线观察，不构成微信目标端验收。

本节为对上文六件资产历史交付记录的增补，不改写其旧统计和集成状态。本次资产任务未切换配置或运行时；旧 `assets/pickups/magnet.glb` 留存历史、不再分发的切换及总体统计由主集成处理。
