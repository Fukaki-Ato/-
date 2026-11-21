# 可编辑图标源

`app-icon.svg`为全自包含分层矢量图；`id`命名对应海面、太阳、波纹、跑道与闪电。
可在矢量编辑器中改形、改色；不含外部图片、脚本、字体引用或人物轮廓。
重跑脚本会按代码定义重新生成，手工改过SVG后请另存，避免用重建替代手改。

```sh
# Pillow仅用于离线资产输出，不进入游戏或主工程依赖。
/tmp/opencode/thunder-ui-KpLhky/venv/bin/python tools/art/app_icon.py \
  --out-dir /tmp/opencode/NEW-icon-output --source /tmp/opencode/NEW-icon-source.svg
```

输出必须是未占用的文件路径；当前已确认候选PNG在`assets/branding/coastal/`。
所有画布为不透明RGB方形，1024/512/144px候选与64/32px观察图来自同一几何定义，未预先裁平台圆角。
没有运行时接线，也没有上传／提审结果。最终规格、图标与工作名称由负责人按官方后台确认。
