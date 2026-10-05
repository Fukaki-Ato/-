"""
技能图标抠图：把 ImageGen 出的「品红底」图标转成 HUD 用的透明 PNG。

为什么需要这一步：生成模型不出透明通道，统一让它画在纯品红 #FF00FF 上
（调色板里没有这个色，键控不会误吃图标本体），再在这里按色度键抠 + 圆形遮罩收边。
圆形遮罩同时干掉右下角的「Qoder AI 生成」水印——水印在圆外，一律裁掉。

产出与 tools/gen_skill_icons.py 同规格：192²、RGBA、四角透明、边缘带 1.5% 羽化。

跑法（本机 PIL 不吃中文路径，输入输出都走 ASCII 暂存目录，再由 shell 拷回仓库）：
  D:/python/python.exe tools/mat_skill_icons.py --in D:/tmp/icons/active.png --out D:/tmp/icons_out/active.png
"""
import argparse
import os

import numpy as np
from PIL import Image

SIZE = 192          # 输出边长，与 gen_skill_icons.py 一致
WORK = 512          # 先降到该尺寸再算遮罩：水印/噪点更少，边缘仍够干净
KEY = np.array([255.0, 0.0, 255.0])   # 键控背景色（纯品红）
T_LO, T_HI = 60.0, 150.0              # 与品红的距离带：带内渐显，带外不透明
FEATHER = 0.015                       # 圆边缘羽化占半径比例
SPILL_K = 40                          # 粉边抑制：R/B 向 G 靠拢的容差


def _extent(profile: np.ndarray) -> tuple[int, int]:
    """取「强不透明像素」在该轴上的最长连续段。
    用连续段而不是 min/max 外接框：右下角的水印也是不透明像素，
    外接框会被它撑到整张图，圆遮罩就失效了。"""
    on = np.flatnonzero(profile > 0.25 * profile.max())
    if on.size == 0:
        raise SystemExit('没找到足够的强不透明像素')
    runs = []
    start = prev = int(on[0])
    for i in on[1:].tolist():
        if i == prev + 1:
            prev = i
            continue
        runs.append((start, prev))
        start = prev = i
    runs.append((start, prev))
    return max(runs, key=lambda s: s[1] - s[0])


def matte(src: str) -> Image.Image:
    img = Image.open(src).convert('RGB')
    img.thumbnail((WORK, WORK), Image.LANCZOS)
    a = np.asarray(img).astype(np.float32)

    # 1) 色度键：离品红越远越不透明
    dist = np.sqrt(((a - KEY) ** 2).sum(axis=2))
    alpha = np.clip((dist - T_LO) / (T_HI - T_LO), 0.0, 1.0)

    # 2) 用强不透明像素的最长连续段定圆心与半径（= 图标本体），水印不参与几何估计
    strong = (alpha > 0.78).sum(axis=0), (alpha > 0.78).sum(axis=1)
    x0, x1 = _extent(strong[0])
    y0, y1 = _extent(strong[1])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = max(x1 - x0, y1 - y0) / 2

    # 3) 圆形遮罩：半径内实、半径外透明，边缘 FEATHER 比例羽化；圆外（含水印）一律裁掉
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    alpha = np.minimum(alpha, np.clip((r * (1 + FEATHER) - d) / (r * FEATHER * 2 + 1e-6), 0, 1))

    # 4) 去粉边：半透明像素的 R/B 压向 G，纯品红残留变成中性灰而不是亮粉
    spill = alpha < 0.98
    g = a[:, :, 1]
    a[:, :, 0] = np.where(spill, np.minimum(a[:, :, 0], g + SPILL_K), a[:, :, 0])
    a[:, :, 2] = np.where(spill, np.minimum(a[:, :, 2], g + SPILL_K), a[:, :, 2])

    # 5) 以圆心为中心裁方图并留一点余量，缩到输出尺寸
    half = r * (1 + FEATHER)
    x0, y0 = int(max(0, cx - half)), int(max(0, cy - half))
    x1, y1 = int(min(w, cx + half)), int(min(h, cy + half))
    box = np.concatenate([a[:, :, :3], (alpha * 255)[:, :, None]], axis=2).astype(np.uint8)
    out = Image.fromarray(box[y0:y1, x0:x1], 'RGBA')
    side = max(x1 - x0, y1 - y0)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def report(path: str) -> None:
    img = Image.open(path)
    a = np.asarray(img)[:, :, 3]
    opaque = float((a > 200).mean())
    print(f'{path}: {img.size[0]}x{img.size[1]} {os.path.getsize(path) / 1024:.1f}KB '
          f'opaque={opaque:.2f} transparent={float((a < 8).mean()):.2f}')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', dest='dst', required=True)
    d = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(d.dst)), exist_ok=True)
    matte(d.src).save(d.dst, 'PNG', optimize=True)
    report(d.dst)


if __name__ == '__main__':
    main()
