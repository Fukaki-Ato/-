# -*- coding: utf-8 -*-
"""主界面背景补图：从合成效果图（badge_matte_src/mainmenu-mockup.png）抹掉全部 UI，
得到可当背景用的纯插画（assets/ui/menu-bg.png）。

卡通平涂风，补图只需「不穿帮」——这些位置最终大部分又被控件盖住。按区域五种补法：
- skygrad ：顶栏货币胶囊区。该行带两侧全是棕榈叶、没有干净天空列可插值，
            改用矩形下方干净天空（行 150-450 中列）按通道做线性拟合、向上外推行渐变。
- clone   ：压在棕榈叶上的徽标区（左活动+任务一块、右设置一块、右成就+排行榜一块），
            取同一棵棕榈另一侧等宽区块水平镜像贴过来，保住叶簇纹理；宽羽化融合。
- sea2    ：牌匾顶伸出的两簇花（伸到地平线以上）。上下各取干净行带做按列垂直插值，
            与下面 sea 带在交界行共用同一 donor，保证连续。
- sea     ：开始牌匾压住的海面/海岸/沙滩大横带。上 donor＝Oval 顶之上的行带、
            下 donor＝牌匾与底栏之间的浪花行带，两者都先按列抹掉灯塔岛/花簇 span，
            再带内按列垂直插值（卡通海就是上深下浅），叠一层钟形权重的镜像浪花当纹理。
- band    ：底栏压住的窄带（底栏不透明全宽，最终全被盖住）。取浪花窄带垂直镜像平铺
            + 强竖模糊 + 向下提亮渐变；矩形让开四角前景花叶，只补中间。

用法：D:/python/python.exe tools/backdrop_clean.py
产物：assets/ui/menu-bg.png（进仓）+ tools/badge_matte_src/menu-bg-draft.png（迭代稿）
"""
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'badge_matte_src', 'mainmenu-mockup.png')
OUT = os.path.join(ROOT, 'assets', 'ui', 'menu-bg.png')
DRAFT = os.path.join(ROOT, 'tools', 'badge_matte_src', 'menu-bg-draft.png')

# (x0, y0, x1, y1, 方法, donor, 羽化(左,上,右,下))
# 羽化环必须落在干净原图上，否则会把原图 UI 的颜色混进来当鬼影；
# 哪一边贴著 UI 轮廓（最终被控件盖住），哪一边羽化给 0 做硬切。
REGIONS = [
    (280, 0, 730, 99, 'skygrad', None, (16, 0, 16, 14)),
    (6, 6, 180, 335, 'clone', (186, 6, 360, 335), (16, 16, 16, 16)),
    (842, 0, 1007, 430, 'clone', (672, 0, 837, 430), (16, 0, 16, 16)),
    # 牌匾顶伸出的两簇花：不抹掉的话它们会留在背景里当「浮空花」，
    # 且抠牌匾的像素差键也找不到它们（背景与合成图此处同色）。补痕落在牌匾轮廓内，被盖住。
    (250, 1062, 350, 1132, 'sea2', None, (10, 10, 10, 0)),
    (640, 1062, 780, 1132, 'sea2', None, (10, 10, 10, 0)),
    (205, 1130, 800, 1355, 'sea', None, (30, 0, 30, 14)),
    (14, 1378, 994, 1548, 'band', None, (10, 10, 10, 10)),
]
# 补完之后从原图贴回的区块：顶栏天空块两侧被矩形切断的棕榈叶尖直接整块贴；
# 底栏四角「压在导航条前面」的前景花叶按颜色掩码贴（只取绿叶/白花，不把棕条角带回来）
POST_PASTES = [
    (230, 6, 292, 99, 'rect', 10),
    (722, 6, 782, 99, 'rect', 10),
    (0, 1390, 92, 1562, 'foliage', 4),
    (930, 1382, 1007, 1562, 'foliage', 4),
]
SEA_TOP = (1116, 1130)     # 牌匾 Oval 顶之上的干净行带（地平线/岛基/沙滩）
SEA_BOT = (1356, 1374)     # 牌匾与底栏之间的干净浪花行带
SKY_FIT = (150, 450)       # 天空垂直渐变拟合用的干净行范围
SKY_COLS = (440, 560)      # 拟合用的干净中列
# 取 donor 时要横插值抹掉的列 span（全图坐标）：灯塔岛 + 牌匾顶两簇花
CLEAN_SPANS = [(468, 664), (258, 342), (648, 772)]


def _lerp(a: np.ndarray, b: np.ndarray, t) -> np.ndarray:
    return a * (1 - t) + b * t


def _smoothstep(t: np.ndarray) -> np.ndarray:
    return t * t * (3 - 2 * t)


def _clean_spans(band: np.ndarray, ox: int) -> np.ndarray:
    """donor 横带里指定列 span 用两侧列横插值抹掉（span 全图坐标，band 局部坐标）。"""
    out = band.copy()
    w = band.shape[1]
    for (gx0, gx1) in CLEAN_SPANS:
        x0, x1 = max(0, gx0 - ox), min(w, gx1 - ox)
        if x1 - x0 < 2 or x0 - 6 < 0 or x1 + 6 > w:
            continue
        left = band[:, x0 - 6:x0 - 2].mean(axis=1, keepdims=True)
        right = band[:, x1 + 2:x1 + 6].mean(axis=1, keepdims=True)
        t = _smoothstep(np.linspace(0, 1, x1 - x0))[None, :, None]
        out[:, x0:x1] = _lerp(left, right, t)
    return out


def _band(img: np.ndarray, rows, x0, x1) -> np.ndarray:
    return _clean_spans(img[rows[0]:rows[1], x0:x1].astype(np.float32), x0).mean(axis=0)


def fill_skygrad(img: np.ndarray, r) -> None:
    x0, y0, x1, y1 = r
    ys = np.arange(SKY_FIT[0], SKY_FIT[1], dtype=np.float32)
    samples = img[SKY_FIT[0]:SKY_FIT[1], SKY_COLS[0]:SKY_COLS[1]].astype(np.float32).mean(axis=1)
    coef = np.polyfit(ys, samples, 1)                     # (2,3)：每通道一条竖直渐变线
    rows = np.arange(y0, y1, dtype=np.float32)
    fill = coef[0][None, :] * rows[:, None] + coef[1][None, :]   # (h,3)
    fill = np.repeat(fill[:, None, :], x1 - x0, axis=1)
    noise = np.random.default_rng(7).normal(0, 1.2, fill.shape)
    fill = np.clip(fill + noise, 0, 255).astype(np.uint8)
    img[y0:y1, x0:x1] = cv2.GaussianBlur(fill, (9, 9), 2.0)


def fill_clone(img: np.ndarray, r, donor) -> None:
    x0, y0, x1, y1 = r
    dx0, dy0, dx1, dy1 = donor
    img[y0:y1, x0:x1] = img[dy0:dy1, dx0:dx1][:, ::-1].copy()


def fill_sea2(img: np.ndarray, r) -> None:
    x0, y0, x1, y1 = r
    top = _band(img, (1046, 1060), x0, x1)
    bot = _band(img, SEA_TOP, x0, x1)
    t = _smoothstep(np.linspace(0, 1, y1 - y0))[:, None, None]
    img[y0:y1, x0:x1] = np.clip(_lerp(top[None], bot[None], t), 0, 255).astype(np.uint8)


def fill_sea(img: np.ndarray, r) -> None:
    x0, y0, x1, y1 = r
    top = _band(img, SEA_TOP, x0, x1)
    bot = _band(img, SEA_BOT, x0, x1)
    h = y1 - y0
    t = _smoothstep(np.linspace(0, 1, h))[:, None, None]
    fill = _lerp(top[None, :, :], bot[None, :, :], t)
    foam = img[SEA_BOT[0]:SEA_BOT[1], x0:x1].astype(np.float32)   # 干净浪花带当纹理
    weight = np.exp(-((np.linspace(0, 1, h) - 0.72) ** 2) / (2 * 0.16 ** 2))[:, None, None] * 0.45
    fill = fill * (1 - weight) + _mirror_tile_v(foam, h) * weight
    img[y0:y1, x0:x1] = np.clip(fill, 0, 255).astype(np.uint8)


def fill_band(img: np.ndarray, r) -> None:
    x0, y0, x1, y1 = r
    donor = img[SEA_BOT[0]:SEA_BOT[1], x0:x1].astype(np.float32)
    fill = _mirror_tile_v(donor, y1 - y0)
    fill = cv2.GaussianBlur(fill.astype(np.uint8), (5, 15), 3.0).astype(np.float32)
    light = 1.0 + 0.10 * np.linspace(0, 1, y1 - y0)[:, None, None]   # 越往下越亮＝干沙
    img[y0:y1, x0:x1] = np.clip(fill * light, 0, 255).astype(np.uint8)


def _mirror_tile_v(strip: np.ndarray, need: int) -> np.ndarray:
    out, flip, total = [], False, 0
    while total < need:
        out.append(strip[::-1] if flip else strip)
        total += strip.shape[0]
        flip = not flip
    return np.concatenate(out, axis=0)[:need]


def feather_blend(orig: np.ndarray, img: np.ndarray, r, f) -> None:
    x0, y0, x1, y1 = r
    fl, ft, fr, fb = f
    gy0, gy1 = max(0, y0 - fl), min(img.shape[0], y1 + fr)
    gx0, gx1 = max(0, x0 - ft), min(img.shape[1], x1 + fb)
    ry = np.arange(gy0, gy1)
    rx = np.arange(gx0, gx1)
    iy = np.ones_like(ry, dtype=np.float32)
    ix = np.ones_like(rx, dtype=np.float32)
    if ft:
        iy = np.minimum(iy, np.clip((ry - y0) / ft, 0, 1))
    if fb:
        iy = np.minimum(iy, np.clip((y1 - 1 - ry) / fb, 0, 1))
    if fl:
        ix = np.minimum(ix, np.clip((rx - x0) / fl, 0, 1))
    if fr:
        ix = np.minimum(ix, np.clip((x1 - 1 - rx) / fr, 0, 1))
    alpha = (iy[:, None] * ix[None, :])[..., None]
    img[gy0:gy1, gx0:gx1] = (orig[gy0:gy1, gx0:gx1] * (1 - alpha)
                             + img[gy0:gy1, gx0:gx1] * alpha).astype(np.uint8)


def paste_back(orig: np.ndarray, img: np.ndarray, r, mode: str, f: int) -> None:
    """把 orig 的区块贴回 img 上层。mode='rect' 整块羽化贴；
    mode='foliage' 只取绿叶/白花像素（掩码羽化），不把导航条棕角带回来。"""
    x0, y0, x1, y1 = r
    gy0, gy1 = max(0, y0 - f), min(img.shape[0], y1 + f)
    gx0, gx1 = max(0, x0 - f), min(img.shape[1], x1 + f)
    ry = np.arange(gy0, gy1)
    rx = np.arange(gx0, gx1)
    inside_y = np.minimum(np.clip((ry - y0) / f, 0, 1), np.clip((y1 - 1 - ry) / f, 0, 1))
    inside_x = np.minimum(np.clip((rx - x0) / f, 0, 1), np.clip((x1 - 1 - rx) / f, 0, 1))
    alpha = inside_y[:, None] * inside_x[None, :]
    if mode == 'foliage':
        patch = orig[gy0:gy1, gx0:gx1].astype(np.int32)
        b, g, rr = patch[..., 0], patch[..., 1], patch[..., 2]
        leaf = (g > rr + 6) & (g > b + 6)
        flower = (b > 225) & (g > 225) & (rr > 225)
        mask = cv2.GaussianBlur((leaf | flower).astype(np.float32), (0, 0), 2.0)
        alpha = alpha * mask
    alpha = alpha[..., None]
    img[gy0:gy1, gx0:gx1] = (img[gy0:gy1, gx0:gx1] * (1 - alpha)
                             + orig[gy0:gy1, gx0:gx1] * alpha).astype(np.uint8)


def main() -> None:
    # cv2.imread/imwrite 在 Windows 上不吃中文路径，走 fromfile/imdecode 与 imencode/tofile
    orig = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR)
    if orig is None:
        raise SystemExit('读不到 ' + SRC)
    img = orig.copy()
    for (x0, y0, x1, y1, how, donor, _f) in REGIONS:
        if how == 'skygrad':
            fill_skygrad(img, (x0, y0, x1, y1))
        elif how == 'clone':
            fill_clone(img, (x0, y0, x1, y1), donor)
        elif how == 'sea2':
            fill_sea2(img, (x0, y0, x1, y1))
        elif how == 'sea':
            fill_sea(img, (x0, y0, x1, y1))
        elif how == 'band':
            fill_band(img, (x0, y0, x1, y1))
    for (x0, y0, x1, y1, _how, _d, f) in REGIONS:
        feather_blend(orig, img, (x0, y0, x1, y1), f)
    for (x0, y0, x1, y1, mode, f) in POST_PASTES:
        paste_back(orig, img, (x0, y0, x1, y1), mode, f)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ok, buf = cv2.imencode('.png', img)
    if not ok:
        raise SystemExit('编码失败')
    for path in (OUT, DRAFT):
        buf.tofile(path)
    print('written', OUT, img.shape)


if __name__ == '__main__':
    main()
