#!/usr/bin/env python3
"""障碍海报贴图生成：去水印 + 缩到游戏贴图尺寸 + 算挡板边框色。

用法（广告墙竖版池，1600x2848 源图，右下角「豆包 AI 生成」）：
    python tools/gen_ad_posters.py --src "D:/挡板障碍海报素材/挡板海报素材" \
        --out assets/obstacles/posters --pick 657,958,279,...

小障碍方图池（2048x2048，水印同样在右下角但更靠上，要挪框）：
    python tools/gen_ad_posters.py --src .../小型挡板海报素材 --glob '*.png' \
        --out assets/obstacles/posters-small --rect 0.78,0.92,1.0,1.0

抖音导出图（底部居中「抖音号：xxx」，纯白不透明 ⇒ 反解无解，只能补绘）：
    python tools/gen_ad_posters.py --src .../小型挡板海报素材 --glob 'share_*.webp' \
        --out assets/obstacles/posters-small --mode douyin --rect 0.0,0.90,1.0,1.0

两类水印口径：
- doubao：obs = orig*(1-a) + 255a 的半透明白字。整批逐像素取最暗 ⇒ a 的紧上界，减掉该最暗图
  自身局部底色（大窗中值）得字形 alpha，再按 a 反解原色；残留暗描边按平坦度补绘。
- douyin：不透明白字（min 通道 >205），反解会炸白。改成连通域找字形 + 补绘（NS inpaint）。
"""
import argparse
import glob
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

FILL_K = 45          # 洞感知邻域插值窗口
SMOOTH_STD_MAX = 12  # 邻域标准差低于该值视为平坦底，直接插值填平


def parse_rect(spec: str, w: int, h: int) -> tuple[int, int, int, int]:
    """--rect 支持 0~1 的比例或像素值，返回取整后的内框（比例按每张图各自换算，混尺寸也能用）。"""
    v = [float(x) for x in spec.split(',')]
    if len(v) != 4:
        raise SystemExit('--rect 需要 4 个数：x0,y0,x1,y1（比例或像素）')
    if max(v) <= 2.0:
        v = [v[0] * w, v[1] * h, v[2] * w, v[3] * h]
    lim = (w, h, w, h)
    return tuple(max(0, min(int(round(x)), lim[i])) for i, x in enumerate(v))


def watermark_alpha(stack: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    """由整批图逐像素最暗值反推半透明水印 alpha（返回 rect 内单通道 float 图）。"""
    x0, y0, x1, y1 = rect
    g = stack.min(axis=0).mean(axis=2)
    floor = cv2.medianBlur(g.astype(np.uint8), 81).astype(np.float32)
    a = np.clip((g - floor) / np.maximum(1e-3, 255.0 - floor), 0.0, 1.0)
    a[a < 0.05] = 0.0
    return a[y0:y1, x0:x1]


def dewatermark(img: np.ndarray, a: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    """按 alpha 反解原色，再清掉白字底下的暗描边残留。"""
    x0, y0, x1, y1 = rect
    out = img.astype(np.float32).copy()
    reg = out[y0:y1, x0:x1]
    rec = np.clip((reg - 255.0 * a[..., None]) / (1.0 - a[..., None]), 0.0, 255.0)

    foot = cv2.dilate((a > 0.03).astype(np.uint8), np.ones((13, 13), np.uint8))
    keep = (1 - foot).astype(np.float32)
    kb = cv2.blur(keep, (FILL_K, FILL_K))
    usable = (kb > 0.25).astype(np.float32)          # 邻域被字形占满处不可插值（会出黑块）
    lum = rec.mean(axis=2)
    mean = cv2.blur(lum * keep, (FILL_K, FILL_K)) / np.maximum(kb, 1e-3)
    std = np.sqrt(np.maximum(cv2.blur((lum - mean) ** 2 * keep, (FILL_K, FILL_K)) / np.maximum(kb, 1e-3), 0))
    fill = np.stack([cv2.blur(rec[..., c] * keep, (FILL_K, FILL_K)) / np.maximum(kb, 1e-3) for c in range(3)], axis=2)

    ref = cv2.medianBlur(lum.astype(np.uint8), 41).astype(np.float32)
    rough = foot & (np.abs(ref - lum) > 6).astype(np.uint8)   # 纹理区残留：只补这些点
    patched = np.where(rough[..., None] > 0,
                       cv2.inpaint(rec.astype(np.uint8), rough * 255, 4, cv2.INPAINT_NS).astype(np.float32), rec)

    w = np.clip((SMOOTH_STD_MAX - std) / SMOOTH_STD_MAX, 0, 1) * cv2.GaussianBlur(foot.astype(np.float32), (0, 0), 2.5) * usable
    out[y0:y1, x0:x1] = patched * (1 - w[..., None]) + fill * w[..., None]
    return out.astype(np.uint8)


def white_text_mask(img: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    """不透明白字（抖音号那类）：先按行投影锁定那一行文字，再取该行全部白像素做补绘掩膜。

    不按连通域高度筛：一行字里「：」「1」这类小笔画只有大字的一半高，按尺寸筛会漏掉半句。
    """
    x0, y0, x1, y1 = rect
    band = img[y0:y1, x0:x1]
    m = (band.min(axis=2) > 205).astype(np.uint8)
    rows = m.sum(axis=1)
    peak = int(rows.max())
    if peak < 20:
        return np.zeros(img.shape[:2], np.uint8)
    hit = np.where(rows > max(8.0, peak * 0.25))[0]
    lo, hi = max(0, int(hit.min()) - 6), min(m.shape[0], int(hit.max()) + 7)
    sub = cv2.dilate(m[lo:hi], np.ones((9, 9), np.uint8))
    mask = np.zeros((img.shape[0], img.shape[1]), np.uint8)
    mask[y0 + lo:y0 + hi, x0:x1] = sub * 255
    return mask


def inpaint_white(img: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    return cv2.inpaint(img, white_text_mask(img, rect), 6, cv2.INPAINT_NS)


def to_square(img: np.ndarray) -> np.ndarray:
    """居中裁成正方形：正方形挡板要「图片完整贴合」，竖构图按高内接会在两侧留大片边框。

    两张牛图（1440x2420）实测居中裁切正好留住完整角色，偏上会切掉身体、偏下会切掉头。
    """
    h, w = img.shape[:2]
    if w == h:
        return img
    side = min(w, h)
    x0, y0 = (w - side) // 2, (h - side) // 2
    return img[y0:y0 + side, x0:x0 + side]


def frame_color(img: np.ndarray) -> str:
    """边框色：取画面四周一圈的均色再压暗（霓虹夜里 bezel 不该比海报亮）。"""
    h, w = img.shape[:2]
    bw, bh = max(4, w // 28), max(4, h // 28)
    ring = np.concatenate([
        img[:bw].reshape(-1, 3), img[-bw:].reshape(-1, 3),
        img[:, :bw].reshape(-1, 3), img[:, -bw:].reshape(-1, 3),
    ])
    r, g, b = (ring.mean(axis=0) * 0.42).astype(int)
    return f"0x{r:02x}{g:02x}{b:02x}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True, help='原始海报目录（不进仓库）')
    ap.add_argument('--out', default='assets/obstacles/posters')
    ap.add_argument('--glob', default='*.png', help='源文件通配（webp 也吃）')
    ap.add_argument('--prefix', default='poster_')
    ap.add_argument('--start', type=int, default=0, help='编号起始值（分两批跑同一池子时避免覆盖）')
    ap.add_argument('--mode', choices=('doubao', 'douyin'), default='doubao')
    ap.add_argument('--rect', default='0.80,0.955,1.0,1.0', help='水印框：x0,y0,x1,y1（比例或像素）')
    ap.add_argument('--width', type=int, default=512, help='贴图宽（高按原图比例推）')
    ap.add_argument('--square', action='store_true', help='去水印后居中裁成正方形（正方形挡板要完整贴合）')
    ap.add_argument('--quality', type=int, default=86, help='JPEG 质量')
    ap.add_argument('--pick', default='', help='逗号分隔的文件名片段，按给出的顺序选图（优先于 --glob 顺序）')
    args = ap.parse_args()

    src = Path(args.src)
    files = sorted(Path(p) for p in glob.glob(str(src / args.glob)))
    if not files:
        raise SystemExit(f'{src} 下没有 {args.glob}')
    if args.mode == 'doubao' and len(files) < 2:
        raise SystemExit('doubao 模式至少需要两张素材，才能从批量最暗值反推水印 alpha')

    keys = [k.strip() for k in args.pick.split(',') if k.strip()]
    if keys:
        picked = []
        for k in keys:
            hit = [p for p in files if k in p.stem]
            if not hit:
                raise SystemExit(f'--pick 片段 {k} 在 {src} 找不到对应文件')
            picked.append(hit[0])
    else:
        picked = files

    w0, h0 = Image.open(picked[0]).size   # PIL 的 size 是 (w, h)，别按 shape 顺序接
    rect0 = parse_rect(args.rect, w0, h0)
    alpha = None
    if args.mode == 'doubao':
        sizes = {Image.open(p).size for p in picked}
        if len(sizes) > 1:
            raise SystemExit(f'doubao 模式要同一尺寸批量反推 alpha，实得 {sizes}')
        stack = np.stack([np.asarray(Image.open(p).convert('RGB')).astype(np.float32) for p in picked])
        alpha = watermark_alpha(stack, rect0)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, p in enumerate(picked, args.start + 1):
        img = np.asarray(Image.open(p).convert('RGB'))
        rect = parse_rect(args.rect, img.shape[1], img.shape[0])   # 混尺寸（如抖音导出）按各自宽高换算
        clean = inpaint_white(img, rect) if args.mode == 'douyin' else dewatermark(img, alpha, rect)
        if args.square:
            clean = to_square(clean)
        oh = round(args.width * clean.shape[0] / clean.shape[1])   # 高按裁切后的宽高比推
        tex = Image.fromarray(clean).resize((args.width, oh), Image.LANCZOS)
        name = f'{args.prefix}{i:02d}.jpg'   # 游戏贴图走 JPEG：同画质比 PNG 小 6~7 倍
        dest = out / name
        tex.convert('RGB').save(dest, quality=args.quality, optimize=True)
        rows.append((name, frame_color(np.asarray(tex)), dest.stat().st_size))
    total = sum(r[2] for r in rows)
    print(f'模式 {args.mode}，rect {rect0}，贴图宽 {args.width}（高按各图比例），共 {len(rows)} 张 / {total / 1024:.0f} KB')
    for name, col, size in rows:
        print(f"  {{ file: '{name}', frame: {col} }},  // {size / 1024:.0f} KB")


if __name__ == '__main__':
    main()
