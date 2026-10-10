#!/usr/bin/env python3
"""把一张 N 行 × M 列的网格生图切成 badge_matte.py 认的「单枚图标源片」。

为什么需要它：一次生 10 枚头像比生 10 次靠谱得多（同一次采样才有统一的描边、上色和
金框），但抠图管线是一张源片对应一枚徽标。这里只负责「切 + 紧裁 + 缩到源片尺寸」，
键色、羽化、glow 描边仍然全部交给 badge_matte.py，不在这里重复实现。

用法（本机 python 在 D:\\python）：
  D:/python/python.exe tools/slice_grid.py --in vibe_images/ava-grid-src_xxx.png \
      --rows 2 --cols 5 --prefix ava --out-dir tools/badge_matte_src --key pink
产物：tools/badge_matte_src/ava_01-icon.png ... ava_10-icon.png（编号＝阅读顺序）
"""
import argparse
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, '..')))


def is_bg(r, g, b, key):
    """与 badge_matte.py 的键色判据保持一致：pink＝r、b 同时明显高于 g；blue＝b 同时高于 r、g。"""
    if key == 'blue':
        return b > r + 60 and b > g + 60 and b > 140
    return r > g + 60 and b > g + 40 and r > 140


def tight_box(im, key, pad, step):
    """在给定图里找「非背景」的外接框；整块都是背景时返回 None。"""
    w, h = im.size
    px = im.load()  # RGB 图是二维取值（x, y），不能按扁平下标取
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(0, h, step):
        for x in range(0, w, step):
            c = px[x, y]
            if not is_bg(c[0], c[1], c[2], key):
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    if x1 < 0:
        return None
    return (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + step + pad), min(h, y1 + step + pad))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--rows', type=int, default=2)
    ap.add_argument('--cols', type=int, default=5)
    ap.add_argument('--prefix', default='ava')
    ap.add_argument('--out-dir', default=os.path.join(ROOT, 'tools', 'badge_matte_src'))
    ap.add_argument('--key', choices=('pink', 'blue'), default='pink')
    ap.add_argument('--max-side', type=int, default=256, help='源片长边：抠图够用就行，别把生图原尺寸塞进仓库')
    ap.add_argument('--pad', type=int, default=6)
    ap.add_argument('--step', type=int, default=2, help='紧框采样步长（px）')
    a = ap.parse_args()

    im = Image.open(a.src).convert('RGB')
    w, h = im.size
    cw, ch = w // a.cols, h // a.rows
    os.makedirs(a.out_dir, exist_ok=True)
    made = []
    for i in range(a.rows * a.cols):
        r, c = divmod(i, a.cols)
        cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        box = tight_box(cell, a.key, a.pad, a.step)
        if box is None or (box[2] - box[0]) < 8 or (box[3] - box[1]) < 8:
            print('%s_%02d 空格子，跳过' % (a.prefix, i + 1))
            continue
        tile = cell.crop(box)
        scale = a.max_side / float(max(tile.size))
        if scale < 1:
            tile = tile.resize((max(1, int(round(tile.size[0] * scale))), max(1, int(round(tile.size[1] * scale)))), Image.LANCZOS)
        out = os.path.join(a.out_dir, '%s_%02d-icon.png' % (a.prefix, i + 1))
        tile.save(out)
        made.append((os.path.relpath(out, ROOT), tile.size))
    for rel, size in made:
        print('%-46s %dx%d' % (rel, size[0], size[1]))
    print('共 %d 枚（网格 %dx%d）' % (len(made), a.rows, a.cols))
    return 0 if made else 1


if __name__ == '__main__':
    sys.exit(main())
