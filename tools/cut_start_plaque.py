# -*- coding: utf-8 -*-
"""从主界面合成效果图抠「开始酷跑」大牌匾（连烤字整块），出 normal+glow 两帧。

抠图键＝像素差：合成图与补好的纯背景（menu-bg.png）逐像素相减，差值大的就是 UI 轮廓。
牌匾bbox 内补图是平滑插值、原图是真实海浪，所以轮廓外也会有一圈差值——那圈 halo 是
真实海色，贴回同一张背景上时与底色同族，读作额外浪花细节，不穿帮。
glow 帧不独立抠：走 badge_matte.synth_glow，由 normal 轮廓外扩淡黄描边，
保证两帧配准、点击换帧不跳位。

用法：D:/python/python.exe tools/cut_start_plaque.py
产物：assets/ui/badges/{normal,glow}/start.png（覆盖旧 start 徽标）
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from badge_matte import synth_glow   # noqa: E402  glow 帧合成与其它徽标同一条管线

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK = os.path.join(ROOT, 'tools', 'badge_matte_src', 'mainmenu-mockup.png')
BG = os.path.join(ROOT, 'assets', 'ui', 'menu-bg.png')
BBOX = (200, 1060, 810, 1345)        # 牌匾含外摆（花/浪/海星）的包围盒
# 背景补图里抹花簇的两块补块：补值与合成图整块都不同，差键会把补块里的天空/远山
# 一起判成牌匾。这两块内只认花瓣/叶片色，其余差值作废。
SEA2_RECTS = [(250, 1062, 350, 1132), (640, 1062, 780, 1132)]
DIFF_T = 60                          # 三通道绝对差之和的阈值
MIN_COMP = 400                       # 小于这个像素数的连通块当噪点丢掉


def read(path: str) -> np.ndarray:
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def main() -> None:
    mock = read(MOCK)
    bg = read(BG)
    diff = np.abs(mock.astype(np.int32) - bg.astype(np.int32)).sum(axis=2)
    mask = np.zeros(diff.shape, np.uint8)
    x0, y0, x1, y1 = BBOX
    mask[y0:y1, x0:x1] = (diff[y0:y1, x0:x1] > DIFF_T).astype(np.uint8) * 255
    rgb = cv2.cvtColor(mock, cv2.COLOR_BGR2RGB).astype(np.int32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    petal = ((r > 205) & (g > 195) & (b > 185)) | ((r > 225) & (r - b > 30) & (g > 140))
    leaf = (g > r + 6) & (g > b + 6)
    flora = cv2.dilate((petal | leaf).astype(np.uint8), np.ones((3, 3), np.uint8))
    for (fx0, fy0, fx1, fy1) in SEA2_RECTS:
        mask[fy0:fy1, fx0:fx1] *= flora[fy0:fy1, fx0:fx1]
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    for k in range(1, n):
        if stats[k, cv2.CC_STAT_AREA] >= MIN_COMP:
            keep[lab == k] = 255
    alpha = cv2.GaussianBlur(keep, (0, 0), 1.2)
    ys, xs = np.where(alpha > 8)
    tx0, tx1, ty0, ty1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = cv2.cvtColor(mock, cv2.COLOR_BGR2RGB)[ty0:ty1, tx0:tx1]
    a = alpha[ty0:ty1, tx0:tx1]
    rgba = np.dstack([rgb, a]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    out_n = os.path.join(ROOT, 'assets', 'ui', 'badges', 'normal', 'start.png')
    out_g = os.path.join(ROOT, 'assets', 'ui', 'badges', 'glow', 'start.png')
    im.save(out_n)
    keep_list = [bool(keep[y, x]) for y in range(ty0, ty1) for x in range(tx0, tx1)]
    synth_glow(im, keep_list).save(out_g)
    print('tight bbox in mockup:', (int(tx0), int(ty0), int(tx1), int(ty1)),
          'size:', im.size, 'aspect:', round(im.size[0] / im.size[1], 3))


if __name__ == '__main__':
    main()
