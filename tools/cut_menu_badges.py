# -*- coding: utf-8 -*-
"""从主界面合成效果图批量抠 8 枚徽标（连烤字标签），出 normal+glow 两帧覆盖旧贴图。

两种抠图键：
- 侧列四枚（活动/任务/成就/排行榜，压在天空/棕榈上）：像素差键——合成图与补好的纯背景
  相减，差值大的就是徽标连标签；halo 是真实叶簇，贴回同一张背景（克隆叶簇）同族不穿帮。
- 底栏四枚（商店/福利手册/仓库/角色，坐在纯棕条上）：与条棕色的色距键；白字标签与图标
  都远离棕色，一并入掩码；竖分隔线在格子矩形之外，不会被带进来。
glow 帧一律走 badge_matte.synth_glow（normal 轮廓外扩淡黄描边），两帧配准不跳位。

用法：D:/python/python.exe tools/cut_menu_badges.py
产物：assets/ui/badges/{normal,glow}/{event,task,achieve,rank,shop,handbook,chest,character}.png
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from badge_matte import synth_glow   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK = os.path.join(ROOT, 'tools', 'badge_matte_src', 'mainmenu-mockup.png')
BG = os.path.join(ROOT, 'assets', 'ui', 'menu-bg.png')
DIFF_T = 60
BROWN_T2 = 900          # 与条棕色距离平方阈值（约 30/通道）
MIN_COMP = 600

# name: (rect, 键)
CUTS = {
    'event':     ((10, 8, 155, 182), 'diff'),
    'task':      ((10, 180, 155, 335), 'diff'),
    'achieve':   ((855, 120, 992, 268), 'diff'),
    'rank':      ((850, 262, 1002, 428), 'diff'),
    'shop':      ((60, 1392, 215, 1548), 'brown'),
    'handbook':  ((305, 1392, 455, 1548), 'brown'),
    'chest':     ((545, 1392, 695, 1548), 'brown'),
    'character': ((790, 1392, 940, 1548), 'brown'),
}


def read(path: str) -> np.ndarray:
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def bar_brown(mock: np.ndarray) -> np.ndarray:
    patch = mock[1400:1420, 240:260].reshape(-1, 3)
    return np.median(patch, axis=0)


def cut_one(mock: np.ndarray, bg: np.ndarray, diff: np.ndarray, brown: np.ndarray,
            name: str, rect, kind: str) -> None:
    x0, y0, x1, y1 = rect
    if kind == 'diff':
        m = (diff[y0:y1, x0:x1] > DIFF_T).astype(np.uint8) * 255
        # 侧列四枚本体不含金以外的绿/天蓝：halo（真实叶簇与天空）按色键剔掉，
        # 贴回背景时就不会在克隆叶簇上多出一圈真叶簇补丁
        rgb = mock[y0:y1, x0:x1].astype(np.int32)
        r, g, b = rgb[..., 2], rgb[..., 1], rgb[..., 0]
        leaf = (g > r + 6) & (g > b + 6)
        sky = (b > r + 20) & (b > 90)   # 含深青叶影（b 不到 150 的那档）
        m = m * (1 - cv2.dilate((leaf | sky).astype(np.uint8), np.ones((3, 3), np.uint8)))
    else:
        d2 = ((mock[y0:y1, x0:x1].astype(np.int32) - brown.astype(np.int32)) ** 2).sum(axis=2)
        m = (d2 > BROWN_T2).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((4, 4), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for k in range(1, n):
        if stats[k, cv2.CC_STAT_AREA] >= MIN_COMP:
            keep[lab == k] = 255
    # 标签与图标之间可能有 1-2px 断缝：再闭一次把整枚连成一块
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    alpha = cv2.GaussianBlur(keep, (0, 0), 1.2)
    alpha = np.where(alpha > 150, alpha, 0).astype(np.uint8)   # 掐掉羽化环里的低 alpha 噪点 veil
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.7)
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise SystemExit(name + ': 掩码为空')
    tx0, tx1, ty0, ty1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = cv2.cvtColor(mock, cv2.COLOR_BGR2RGB)[y0:y1, x0:x1][ty0:ty1, tx0:tx1]
    a = alpha[ty0:ty1, tx0:tx1]
    im = Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), 'RGBA')
    base = os.path.join(ROOT, 'assets', 'ui', 'badges')
    im.save(os.path.join(base, 'normal', name + '.png'))
    keep_list = [bool(keep[ty0 + y, tx0 + x]) for y in range(ty1 - ty0) for x in range(tx1 - tx0)]
    synth_glow(im, keep_list).save(os.path.join(base, 'glow', name + '.png'))
    print(f'{name}: rect={rect} size={im.size} aspect={im.size[0] / im.size[1]:.3f}')


def main() -> None:
    mock = read(MOCK)
    bg = read(BG)
    diff = np.abs(mock.astype(np.int32) - bg.astype(np.int32)).sum(axis=2)
    brown = bar_brown(mock)
    for name, (rect, kind) in CUTS.items():
        cut_one(mock, bg, diff, brown, name, rect, kind)


if __name__ == '__main__':
    main()
