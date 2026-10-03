# -*- coding: utf-8 -*-
"""从纯背景切分层动效素材到 assets/ui/backdrop/：云团、海鸥、可平铺浪花带。

- 云/海鸥用「与局部天空色的距离」做 alpha（smoothstep 两阈值，边缘天然软）；
- 需要横向无缝平铺的（云条/浪花带）用「原图 + 水平镜像」拼成周期条，
  镜像交界无接缝，UV RepeatWrapping 循环位移时循环边界不跳变；
- 全部取自背景的干净区（不碰补图区），海鸥取三只不同姿态供错峰飞入。

用法：D:/python/python.exe tools/cut_backdrop_layers.py
"""
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = os.path.join(ROOT, 'assets', 'ui', 'menu-bg.png')
MOCK = os.path.join(ROOT, 'tools', 'badge_matte_src', 'mainmenu-mockup.png')
OUT = os.path.join(ROOT, 'assets', 'ui', 'backdrop')

CLOUD_T = (10, 26)      # 与天空亮度差的 smoothstep 双阈值（缺省）
GULL_T = (22, 48)       # 与天空色距的 smoothstep 双阈值
CLOUDS = {'cloud_a': ((240, 420, 480, 525), CLOUD_T),
          'cloud_b': ((520, 555, 780, 650), (5, 16))}   # 高空卷云对比度低，阈值单独放低
GULLS = {'gull_a': (133, 573, 207, 630), 'gull_b': (230, 920, 310, 980), 'gull_c': (628, 843, 692, 882)}
FOAM_ROWS = (1330, 1374)     # 浪花弧 + 湿沙；取合成图（纯背景此处是补图平滑带）
FOAM_X = (150, 550)          # 让开底栏四角的前景花，否则镜像平铺后花成对出现


def read(path: str) -> np.ndarray:
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def write(path: str, img: np.ndarray) -> None:
    ok, buf = cv2.imencode('.png', img)
    if not ok:
        raise SystemExit('编码失败 ' + path)
    buf.tofile(path)


def smooth01(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def key_alpha(patch_bgr: np.ndarray, mode: str, thr=None) -> np.ndarray:
    """patch 内按「与天空的差异」出 alpha。云看亮度差，海鸥看色距。"""
    f = patch_bgr.astype(np.float32)
    sky = np.median(f.reshape(-1, 3)[::7], axis=0)          # 矩形内天空占多数，中位数即天空
    if mode == 'cloud':
        d = f.mean(axis=2) - sky.mean()
        t0, t1 = thr or CLOUD_T
    else:
        d = np.sqrt(((f - sky) ** 2).sum(axis=2))
        t0, t1 = GULL_T
    return smooth01((d - t0) / (t1 - t0))


def cut_sprite(bg: np.ndarray, rect, mode: str, thr=None) -> np.ndarray:
    x0, y0, x1, y1 = rect
    patch = bg[y0:y1, x0:x1]
    a = key_alpha(patch, mode, thr)
    a = cv2.GaussianBlur(a, (0, 0), 0.8)
    ys, xs = np.where(a > 0.04)
    if len(xs) == 0:
        raise SystemExit(f'{rect} 掩码为空')
    tx0, tx1, ty0, ty1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = cv2.cvtColor(patch[ty0:ty1, tx0:tx1], cv2.COLOR_BGR2RGB)
    alpha = (a[ty0:ty1, tx0:tx1] * 255).astype(np.uint8)
    return np.dstack([rgb, alpha]).astype(np.uint8)


def mirror_strip(half: np.ndarray) -> np.ndarray:
    """原图 + 水平镜像 → 横向周期无缝条。half 可为 BGRA 或 BGR。"""
    return np.concatenate([half, half[:, ::-1]], axis=1)


def main() -> None:
    bg = read(BG)
    os.makedirs(OUT, exist_ok=True)
    for name, (rect, thr) in CLOUDS.items():
        sprite = cut_sprite(bg, rect, 'cloud', thr)
        strip = mirror_strip(sprite)
        write(os.path.join(OUT, name + '.png'), sprite)
        write(os.path.join(OUT, name + '_strip.png'), strip)
        print(name, 'sprite', sprite.shape[:2], 'strip', strip.shape[:2])
    for name, rect in GULLS.items():
        sprite = cut_sprite(bg, rect, 'gull')
        write(os.path.join(OUT, name + '.png'), sprite)
        print(name, sprite.shape[:2])
    foam = read(MOCK)[FOAM_ROWS[0]:FOAM_ROWS[1], FOAM_X[0]:FOAM_X[1]]
    write(os.path.join(OUT, 'foam_strip.png'), mirror_strip(foam))
    print('foam_strip', mirror_strip(foam).shape[:2])


if __name__ == '__main__':
    main()
