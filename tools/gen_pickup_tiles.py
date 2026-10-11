#!/usr/bin/env python3
"""道具箱贴图生成：把金框徽标网格切成一枚枚徽标，抠掉粉色键底，再合成到道具箱正面贴图上。

管线与大厅徽标同一套（tools/slice_grid.py + tools/badge_matte.py 的判据），只是产物不同：
徽标要贴在 3D 道具箱的六个面上，所以最终图是「不透明方砖 = 淡色底 + 居中徽标」，
不是带 alpha 的 UI 贴图（带 alpha 的话箱子会透出后面的场景）。底色往白里并得很淡
（外圈 62%、内板 88%），整块砖里只有徽标自己是高饱和的，黑夜里一眼认得出是什么道具。

用法（本机 python 在 D:\\python；源片是 4×2 金框徽标网格，已随仓库入库）：
  python tools/gen_pickup_tiles.py --src tools/pickup_badge_src/pickup-badge-grid.png \\
      --ids item_magnet,item_shield,item_jetpack,item_board,item_multiplier,item_boots,item_helmet,item_default \\
      --rows 2 --cols 4 --wipe 0.88,0.955,1.0,1.0
改完要拿这条原样重跑：表里的 bg 与 assets/pickups/tiles/*.jpg 必须出自这份源片，字节才对得上。

--wipe 是「涂成键色」的矩形（比例或像素）：生图服务会在右下角压一枚「Qoder AI 生成」水印，
它落在最后一格里，不涂掉会被当成徽标内容一起抠进来。
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PINK = (255, 63, 164)          # 生图用的键色，与 is_pink 判据配套
BADGE_FILL = 0.78              # 徽标占方砖的比例（其余留底色边距）


def is_pink(rgb: np.ndarray) -> np.ndarray:
    """与 slice_grid.py / badge_matte.py 同一条键色判据：r、b 同时明显高于 g。"""
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    return (r > g + 60) & (b > g + 40) & (r > 140)


def parse_box(spec: str, w: int, h: int) -> tuple[int, int, int, int]:
    v = [float(x) for x in spec.split(',')]
    if len(v) != 4:
        raise SystemExit('--wipe 需要 4 个数：x0,y0,x1,y1（比例或像素）')
    if max(v) <= 2.0:
        v = [v[0] * w, v[1] * h, v[2] * w, v[3] * h]
    lim = (w, h, w, h)
    return tuple(max(0, min(int(round(x)), lim[i])) for i, x in enumerate(v))


def cut_badge(cell: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """抠掉粉键底 → (紧裁后的 RGB, 0~1 羽化 alpha)。"""
    bg = is_pink(cell)
    fg = (~bg).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))   # 去掉零散噪点
    ys, xs = np.where(fg > 0)
    if len(xs) < 64:
        raise SystemExit('格子里没找到徽标内容，检查 --rows/--cols 或键色')
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    # 羽化前先把边缘一圈键色像素剔掉，否则粉边会留在轮廓上（色溢）
    erode = cv2.erode(fg, np.ones((3, 3), np.uint8))
    spill = (fg - erode) > 0
    rgb = cell.astype(np.float32)
    for c in range(3):
        band = rgb[..., c][spill]
        if band.size:
            rgb[..., c][spill] = np.clip(band * 1.06 - (PINK[c] * 0.06), 0, 255)   # 往反方向压掉一点粉
    alpha = cv2.GaussianBlur(erode.astype(np.float32) * 255.0, (0, 0), 1.4) / 255.0
    pad = max(2, int(round(0.02 * max(y1 - y0, x1 - x0))))
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(rgb.shape[0], y1 + pad), min(rgb.shape[1], x1 + pad)
    return rgb[y0:y1, x0:x1].astype(np.uint8), alpha[y0:y1, x0:x1]


def accent_rgb(rgb: np.ndarray, alpha: np.ndarray) -> tuple[int, int, int]:
    """徽标主色：取最艳的一批像素的均色。金框是每枚共有的，按色相剔掉，
    否则八块砖会全是同一个金色调，「与徽标适配」就白做了。"""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    keep = (alpha > 0.5) & (hsv[..., 1] > 115) & (hsv[..., 2] > 70) & (hsv[..., 2] < 245)
    hue = hsv[..., 0]
    keep &= ~((hue >= 14) & (hue <= 30))          # OpenCV 色相 0-179：金/琥珀大致落在这段
    px = rgb[keep]
    if len(px) < 48:
        px = rgb[alpha > 0.5]
    if len(px) == 0:
        return (34, 38, 46)
    return tuple(int(v) for v in px.mean(axis=0))


def mix(c: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    """往白里并：k=0 原色，k=1 纯白。背景要淡（用户 2026-10-07：淡化背景、箱子提亮、
    让道具本身更醒目），所以外圈 k≈0.62、内板 k≈0.88，徽标自己是唯一的高饱和块。"""
    return tuple(min(255, int(round(v * (1 - k) + 255 * k))) for v in c)


def make_tile(rgb: np.ndarray, alpha: np.ndarray, size: int) -> tuple[Image.Image, int]:
    accent = accent_rgb(rgb, alpha)
    outer = mix(accent, 0.62)
    inner = mix(accent, 0.88)
    bg = outer[0] << 16 | outer[1] << 8 | outer[2]
    tile = Image.new('RGB', (size, size), outer)
    dr = ImageDraw.Draw(tile)
    inset = round(size * 0.06)
    dr.rounded_rectangle([inset, inset, size - inset, size - inset], radius=round(size * 0.12),
                         fill=inner, outline=(214, 178, 92), width=max(2, size // 64))   # 外圈描一道金边，接大厅徽标的框
    side = round(size * BADGE_FILL)
    side = side - side % 2
    badge = Image.fromarray(rgb).resize((side, side), Image.LANCZOS)
    a = Image.fromarray((alpha * 255).astype(np.uint8)).resize((side, side), Image.LANCZOS)
    pos = ((size - side) // 2, (size - side) // 2)
    tile.paste(badge, pos, a)
    return tile, bg


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True, help='徽标网格生图（粉键底）')
    ap.add_argument('--out', default='assets/pickups/tiles')
    ap.add_argument('--ids', required=True, help='逗号分隔道具 id，按网格阅读顺序对齐')
    ap.add_argument('--rows', type=int, default=2)
    ap.add_argument('--cols', type=int, default=4)
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--wipe', default='', help='涂成键色的矩形（比例或像素），用来去掉生图水印')
    args = ap.parse_args()

    im = Image.open(args.src).convert('RGB')
    w, h = im.size
    arr = np.asarray(im).copy()
    ids = [s.strip() for s in args.ids.split(',') if s.strip()]
    if len(ids) != args.rows * args.cols:
        raise SystemExit(f'--ids 给了 {len(ids)} 个，网格是 {args.rows}x{args.cols}={args.rows * args.cols} 格')
    if args.wipe:
        x0, y0, x1, y1 = parse_box(args.wipe, w, h)
        arr[y0:y1, x0:x1] = PINK
    cw, ch = w // args.cols, h // args.rows

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, item in enumerate(ids):
        r, c = divmod(i, args.cols)
        cell = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
        rgb, alpha = cut_badge(cell)
        side = max(rgb.shape[0], rgb.shape[1])
        pad = np.full((side, side, 3), 255, np.uint8)
        pad[:rgb.shape[0], :rgb.shape[1]] = rgb
        a = np.zeros((side, side), np.float32)
        a[:alpha.shape[0], :alpha.shape[1]] = alpha
        tile, bg = make_tile(pad, a, args.size)
        dest = out / f'{item}.jpg'
        tile.save(dest, quality=args.quality, optimize=True)
        rows.append((item, dest.name, bg, dest.stat().st_size))
    print(f'方砖 {args.size}px，共 {len(rows)} 枚 / {sum(r[3] for r in rows) / 1024:.0f} KB')
    for item, name, bg, size in rows:
        print(f"  {{ item: '{item}', file: '{name}', bg: 0x{bg:06x} }},  // {size / 1024:.0f} KB")


if __name__ == '__main__':
    main()
