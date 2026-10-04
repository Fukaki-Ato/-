# -*- coding: utf-8 -*-
"""主界面背景补图：从合成效果图（badge_matte_src/mainmenu-mockup.png）抹掉全部 UI，
得到纯插画（tools/badge_matte_src/menu-bg.png），再由 slice_backdrop_bands.py 横切成四层进 assets/ui/backdrop/。

卡通平涂风，补图只需「不穿帮」。三种补法：
- silhouette inpaint：掩码＝UI 自己的轮廓（牌匾用抠图 alpha、底栏用圆角矩形），
  四周全是真实海浪/沙滩/地平线/天空，cv2.inpaint(NS) 从边界往内推 ⇒ 颜色天然对、
  无矩形边。早先的「整矩形按列垂直插值」会出竖纹矩形，已弃用。
- skygrad ：顶栏货币胶囊区。该行带两侧全是棕榈叶、没有干净天空列可插值，
            改用矩形下方干净天空（行 150-450 中列）按通道做线性拟合、向上外推行渐变。
- clone   ：压在棕榈叶上的徽标区（左活动+任务一块、右设置+成就+排行榜一块），
            取同一棵棕榈另一侧等宽区块水平镜像贴过来，保住叶簇纹理；宽羽化融合。
补完再贴回：顶栏天空块两侧被切断的棕榈叶尖整块贴；底栏四角「压在导航条前面」的
前景花叶按绿叶/白花颜色掩码贴（参考图里它们就在条上层）。

用法：D:/python/python.exe tools/backdrop_clean.py
产物：assets/ui/menu-bg.png（进仓）+ vibe_images/menu-bg-draft.png（迭代稿，不进仓）
"""
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'badge_matte_src', 'mainmenu-mockup.png')
PLAQUE_ALPHA = os.path.join(ROOT, 'assets', 'ui', 'badges', 'normal', 'start.png')
OUT = os.path.join(ROOT, 'tools', 'badge_matte_src', 'menu-bg.png')   # 补图成品是切层源，不进 assets
DRAFT = os.path.join(ROOT, 'vibe_images', 'menu-bg-draft.png')   # vibe_images 被 .git/info/exclude 忽略

# (x0, y0, x1, y1, 方法, donor, 羽化(左,上,右,下))；羽化环必须落在干净原图上
REGIONS = [
    (280, 0, 730, 99, 'skygrad', None, (16, 0, 16, 14)),
    (6, 6, 180, 335, 'clone', (186, 6, 360, 335), (16, 16, 16, 16)),
    (842, 0, 1007, 430, 'clone', (672, 0, 837, 430), (16, 0, 16, 16)),
]
# (名字, 包围盒, 掩码膨胀px, inpaint 半径)；'bar' 的包围盒即圆角矩形掩码
SILHOUETTES = [
    ('start', (207, 1064, 793, 1347), 6, 6),
    ('bar', (18, 1382, 990, 1548), 0, 8),
]
POST_PASTES = [
    (230, 6, 292, 99, 'rect', 10),
    (722, 6, 782, 99, 'rect', 10),
    (0, 1390, 92, 1562, 'foliage', 4),
    (930, 1382, 1007, 1562, 'foliage', 4),
]
SKY_FIT = (150, 450)       # 天空垂直渐变拟合用的干净行范围
SKY_COLS = (440, 560)      # 拟合用的干净中列
BAR_RADIUS = 24


def read(path: str) -> np.ndarray:
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_UNCHANGED)


def fill_skygrad(img: np.ndarray, r) -> None:
    x0, y0, x1, y1 = r
    ys = np.arange(SKY_FIT[0], SKY_FIT[1], dtype=np.float32)
    samples = img[SKY_FIT[0]:SKY_FIT[1], SKY_COLS[0]:SKY_COLS[1]].astype(np.float32).mean(axis=1)
    coef = np.polyfit(ys, samples, 1)                     # (2,3)：每通道一条竖直渐变线
    rows = np.arange(y0, y1, dtype=np.float32)
    fill = coef[0][None, :] * rows[:, None] + coef[1][None, :]   # (h,3) 横向均匀
    fill = np.repeat(fill[:, None, :], x1 - x0, axis=1)
    noise = np.random.default_rng(7).normal(0, 1.2, fill.shape)
    fill = np.clip(fill + noise, 0, 255).astype(np.uint8)
    img[y0:y1, x0:x1] = cv2.GaussianBlur(fill, (9, 9), 2.0)


def fill_clone(img: np.ndarray, r, donor) -> None:
    x0, y0, x1, y1 = r
    dx0, dy0, dx1, dy1 = donor
    img[y0:y1, x0:x1] = img[dy0:dy1, dx0:dx1][:, ::-1].copy()


def silhouette_mask(shape, name: str, rect, dilate: int) -> np.ndarray:
    x0, y0, x1, y1 = rect
    mask = np.zeros(shape[:2], np.uint8)
    if name == 'start':
        rgba = read(PLAQUE_ALPHA)
        a = rgba[..., 3]
        mask[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = (a > 40).astype(np.uint8) * 255
    else:
        cv2.rectangle(mask, (x0, y0), (x1, y1), 255, -1)
        cv2.rectangle(mask, (0, 0), (x0 + BAR_RADIUS, y0 + BAR_RADIUS), 0, -1)   # 四角挖圆
        cv2.rectangle(mask, (x1 - BAR_RADIUS, y0), (x1, y0 + BAR_RADIUS), 0, -1)
        cv2.rectangle(mask, (0, y1 - BAR_RADIUS), (x0 + BAR_RADIUS, y1), 0, -1)
        cv2.rectangle(mask, (x1 - BAR_RADIUS, y1 - BAR_RADIUS), (x1, y1), 0, -1)
        for (cx, cy) in [(x0 + BAR_RADIUS, y0 + BAR_RADIUS), (x1 - BAR_RADIUS, y0 + BAR_RADIUS),
                         (x0 + BAR_RADIUS, y1 - BAR_RADIUS), (x1 - BAR_RADIUS, y1 - BAR_RADIUS)]:
            cv2.circle(mask, (cx, cy), BAR_RADIUS, 255, -1)
    if dilate:
        mask = cv2.dilate(mask, np.ones((dilate * 2 + 1, dilate * 2 + 1), np.uint8))
    return mask


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
    for (name, rect, dilate, radius) in SILHOUETTES:
        mask = silhouette_mask(img.shape, name, rect, dilate)
        img = cv2.inpaint(img, mask, radius, cv2.INPAINT_NS)
    for (x0, y0, x1, y1, how, donor, _f) in REGIONS:
        if how == 'skygrad':
            fill_skygrad(img, (x0, y0, x1, y1))
        elif how == 'clone':
            fill_clone(img, (x0, y0, x1, y1), donor)
    for (x0, y0, x1, y1, _how, _d, f) in REGIONS:
        feather_blend(orig, img, (x0, y0, x1, y1), f)
    for (x0, y0, x1, y1, mode, f) in POST_PASTES:
        paste_back(orig, img, (x0, y0, x1, y1), mode, f)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ok, buf = cv2.imencode('.png', img)
    if not ok:
        raise SystemExit('编码失败')
    os.makedirs(os.path.dirname(DRAFT), exist_ok=True)
    for path in (OUT, DRAFT):
        buf.tofile(path)
    print('written', OUT, img.shape)


if __name__ == '__main__':
    main()
