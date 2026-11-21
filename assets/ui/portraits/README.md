# 微信角色肖像

九张 coastal 角色 `char_*.png` 均由当前 `assets/characters/coastal/*.glb` 重新导入 Blender 后实际渲染：
Idle 0.4s、观察角12°、384×512、透明背景。角色 ID 与 `config/characters.json` 对应。
生成方式见 `tools/art/README.md`；不是用于冒充3D模型升级的替代立绘。

WX大厅/结算加载这些肖像，启动不再解码旧木牌菜单的25张徽标/背景图。
所有图在任务拥有的目录中可重复生成；模型更新后应同步重渲染。
原五个角色派生肖像的素材权利仍随原GLB待核实，四名新角色来源见 `art-source/coastal/NEW-ROSTER.md`。
Cycles 的灯光与画面不是微信运行时像素证据。

整合后的第十张 `char_penguin.png` 来自仓库既有 `apps/web/src/assets/character-select/portraits/penguin.webp`，
经 Canvas 原尺寸透明转码为 384×464 PNG，浏览器解码逐像素一致；不是 coastal 模型重渲染或新增生成图。
企鹅原素材权利仍沿用原输入来源，转码不改变授权状态。WX 启动器加载全部十张真实肖像。
