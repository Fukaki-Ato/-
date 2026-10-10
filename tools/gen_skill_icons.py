"""
技能图标生成（局内 HUD 用）：一枚主动、一枚被动，所有角色通用同一套图。

为什么不复用 assets/ui/badges/*：那批是大厅板块徽标（金框贴图、尺寸 290~604 不一、
带烘焙好的中文标签），语义是「入口」；这里要的是「技能状态灯」，需要
  1) 干净的圆形底 + 明确的高/暗两态（亮=可释放/可触发，暗=不可用）；
  2) 主动/被动靠**颜色与图形**区分而不是文字（局内已有 HUD 文字说明）；
  3) 透明外区，四角留空以便九宫格拉伸不变形。

产出（确定性，无随机）：
  assets/ui/skills/active.png   主动技能：琥珀金圆底 + 闪电（可释放时高亮）
  assets/ui/skills/passive.png  被动技能：青蓝圆底 + 盾牌/心形环（生效时高亮）
两张图都用「亮态」烘焙，暗态由 UI 层用 backgroundOpacity + 乘色压暗（见
packages/game/src/ui/skillIcons.ts），这样一张图就够，不进版本库两份。

跑法： D:/python/python.exe tools/gen_skill_icons.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "ui", "skills")
SIZE = 192          # 输出边长（UI 层按 44~56px 显示，留足缩放余量）
SS = 4              # 超采样倍数：先画大再降采样，得到抗锯齿边缘
PAD = 6             # 透明外边距（px，输出尺度）


def _rgba():
    return Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))


def _scaled(v):
    return v * SS


def disc(draw, box, fill=None, outline=None, width=0):
    draw.ellipse(
        [_scaled(c) for c in box],
        fill=fill,
        outline=outline,
        width=_scaled(width),
    )


def bolt(draw, cx, cy, r, fill):
    """闪电：七段折线造型，尖端朝上"""
    pts = [
        (0.00, -1.00), (-0.42, 0.06), (-0.10, 0.06),
        (-0.26, 1.00), (0.46, -0.14), (0.12, -0.14),
    ]
    poly = [(cx + px * r, cy + py * r) for px, py in pts]
    draw.polygon([(_scaled(x), _scaled(y)) for x, y in poly], fill=fill)


def shield(draw, cx, cy, r, fill, outline=None, width=0):
    """盾牌：上宽下尖的五边形描边造型"""
    top = cy - r
    bot = cy + r
    half = r * 0.78
    poly = [
        (cx - half, top + r * 0.18),
        (cx, top),
        (cx + half, top + r * 0.18),
        (cx + half, cy + r * 0.28),
        (cx, bot),
        (cx - half, cy + r * 0.28),
    ]
    pts = [(_scaled(x), _scaled(y)) for x, y in poly]
    if outline:
        draw.line(pts + [pts[0]], fill=outline, width=_scaled(width), joint="curve")
    else:
        draw.polygon(pts, fill=fill)


def ring(draw, cx, cy, r, fill, width):
    draw.ellipse(
        [_scaled(c) for c in (cx - r, cy - r, cx + r, cy + r)],
        outline=fill, width=_scaled(width),
    )


def bake(draw_fn):
    """画到超采样画布再降采样，得到干净边缘"""
    img = _rgba()
    d = ImageDraw.Draw(img)
    draw_fn(d)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    # 轻微外发光：让图标在明亮海滨场景上也立得住（跑酷背景是浅蓝/亮沙）
    glow = img.filter(ImageFilter.GaussianBlur(3))
    out = Image.alpha_composite(glow, img)
    return out


def make_active():
    """主动技能：琥珀金圆底 + 深棕描边 + 奶白闪电（亮态）"""
    c = SIZE / 2
    r = SIZE / 2 - PAD

    def paint(d):
        disc(d, (c - r, c - r, c + r, c + r), fill=(255, 205, 74, 255))
        disc(d, (c - r, c - r, c + r, c + r), outline=(122, 74, 20, 255), width=4)
        ring(d, c, c, r - 9, (255, 240, 190, 190), 2)
        bolt(d, c, c - 2, r * 0.46, (255, 252, 240, 255))

    return bake(paint)


def make_passive():
    """被动技能：青蓝圆底 + 深蓝描边 + 奶白盾牌（亮态）"""
    c = SIZE / 2
    r = SIZE / 2 - PAD

    def paint(d):
        disc(d, (c - r, c - r, c + r, c + r), fill=(58, 176, 232, 255))
        disc(d, (c - r, c - r, c + r, c + r), outline=(18, 62, 104, 255), width=4)
        ring(d, c, c, r - 9, (206, 240, 255, 190), 2)
        shield(d, c, c + 1, r * 0.44, None, outline=(240, 252, 255, 255), width=7)
        # 盾心小点：暗示「被动/常驻」而非可点击的主动键
        disc(d, (c - 6, c - r * 0.12, c + 6, c + r * 0.42), fill=(240, 252, 255, 255))

    return bake(paint)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, img in (("active", make_active()), ("passive", make_passive())):
        path = os.path.join(OUT_DIR, f"{name}.png")
        img.save(path, "PNG", optimize=True)
        a = np.asarray(img)
        alpha = a[:, :, 3]
        ys, xs = np.nonzero(alpha > 8)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if xs.size else None
        print(
            f"{path}: {img.size[0]}x{img.size[1]} "
            f"{os.path.getsize(path) / 1024:.1f}KB opaque_bbox={bbox}"
        )


if __name__ == "__main__":
    main()