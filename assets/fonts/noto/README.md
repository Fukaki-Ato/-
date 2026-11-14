# WX 字体：Noto OFL + 原创几何符号

本目录是微信运行时的字体输入；根目录的旧混合图集保留给历史 Web 路径，不再随 WX 分发。

- 正文字体：Noto Sans CJK SC Regular，© 2014–2021 Adobe，SIL OFL 1.1。
- 许可全文：`NotoSansSC-OFL.txt`；确切输入、来源网址、SHA256及生成统计在`provenance.json`。
- Noto 缺少的六枚通用 UI 标志 `ϟ ⁻ ⚑ ✔ ✦ ❤` 来自`licensed-symbols.mjs`手写几何轮廓。
  没有读旧图集或使用 Microsoft/Segoe 字体回退。
- Latin 95字形、CJK/符号1509字形，共1604个扫描字符；两图均不超过2048px单轴，40px源字号。
- 排版采用源字体 OS/2 typo 基线880/-120，而非hhea的1160/-288安全范围；两图共用同一基线。
  UV保留精确单元边缘比率，避免2K图集三位小数引入1–2px取样偏移。

## 重建

源 OTF 不进入小游戏包。可复用已有合法输入，或从`provenance.json`的官方网址取得同一版本，
生成器会核对固定源SHA256，避免无意换成未记录字体。fontgen工具依赖使用独立锁安装：

```sh
npm ci --prefix tools/fontgen
node tools/fontgen/licensed.mjs --font /path/to/NotoSansCJKsc-Regular.otf --out /path/to/NEW-output
```

输出目录必须不存在或为空；重建到新的任务目录后复核覆盖、页面截图与包体，再替换已确认的本目录产物。
主工程`npm ci`与构建直接消费已提交图集，不需要系统字体、外部OTF或fontgen依赖。
扫描来源仍沿用原charset工具（共享游戏、WX/Web源码及配置）；根目录历史图集保留，不改其已有字形。

## 观察边界

已用同源UiHost/shader离线比较旧/新大厅、商店、角色、任务、手册、设置、结算和手机HUD，
新来源均无缺字；词条、数字与主要按钮布局检查通过。候选与正式目录生成物逐字节相等。
这些是离线软件OpenGL与本地行为检查，微信原生图片解码、设备排版与性能仍需目标端验收。
