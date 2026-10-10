#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
徽标重抠工具：消掉「从参考图抠图」留下的三类痕迹——硬边锯齿、残留假底、边缘色溢。

用法：
  python tools/badge_matte.py --inspect                 # 只体检，不写文件
  python tools/badge_matte.py --apply --dry-out DIR     # 写到别处先眼看（不动仓库）
  python tools/badge_matte.py --apply                   # 原地重写 assets/ui/badges/**

回滚：这些 PNG 都在 git 里，改坏了用 git checkout -- assets/ui/badges 还原，不留 .bak 垃圾文件。
  python tools/badge_matte.py --apply --only gem shop

为什么 glow 帧不独立抠：
  每枚徽标两帧贴图，glow 画布正好是 normal 四周各 +5px，内容同一个位置。若两帧各自
  抠再各自裁，框会差几像素，点击换帧时图案就会跳位、缩放。所以只抠 normal，glow 的
  掩码由 normal 的掩码平移推导：normal 判为背景、且 glow 该处颜色与 normal 该处一致的
  才算背景 —— 这样残留底被去掉，而 glow 那圈高亮描边（颜色与底不同）完整保留。

normal 的处理链（顺序即质量顺序，不要调换）：
 1 找假底种子：外圈已有透明就用透明当种子；若四边框几乎全是同一平涂色，判定整块是
   残留底（底栏四格那种棕色方块），把边框也并入种子，并改用「与均色相近」的全局色判
   —— 平涂底带轻微渐变，按邻居色差生长会顺着渐变一路漏进图案本体。
 2 区域生长：只吞并与种子连通、且通过色判的邻居，遇到图案硬边自然停住。
 3 一次性去色溢：只剥掉「贴着背景、颜色又几乎等于背景」的那 1 圈像素（金币/钻石外圈
   的蓝天残留、开始徽标的白边光晕）。只许一轮：多轮会一层层啃进图案。
 4 蒙版羽化：对 alpha 做高斯模糊，把二值硬边变成平滑过渡 —— 原图 alpha 只有 0/255
   两档，斜边全是锯齿台阶，这一步才是「看不出抠图痕迹」的关键。
 5 颜色回填：过渡带的颜色由内部实心区向外扩散推出，避免羽化把被删掉的底色混进轮廓。
 6 紧裁补白：按 lobbyView 的槽位比例补透明边，杜绝再次非等比拉伸。
"""
import argparse
import os
import sys
from collections import deque
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BADGE_DIR = os.path.join(ROOT, 'assets', 'ui', 'badges')

# 14 枚徽标在 lobbyView 里的实际显示尺寸（宽×高，CSS px）。
# 裁切后按这个比例补透明边，保证贴图不再被非等比拉伸。
# 生图重做的六枚现在是「纯图标」，标签改由 UI 真文字渲染，所以槽位是正方形。
SLOTS = {
    'avatar': (46, 46), 'coin': (22, 22), 'gem': (23, 24), 'settings': (36, 36),
    'event': (55, 55), 'achieve': (55, 55), 'task': (55, 66), 'rank': (55, 55),
    'start': (150, 68), 'castle': (66, 66),
    'shop': (62, 62), 'handbook': (62, 62), 'chest': (62, 62), 'character': (62, 62),
    # 档案面板那 10 枚二次元头像（一次生图 2×5 网格，tools/slice_grid.py 切出来的）
    **{n: (32, 32) for n in ('ava_01', 'ava_02', 'ava_03', 'ava_04', 'ava_05',
                             'ava_06', 'ava_07', 'ava_08', 'ava_09', 'ava_10')},
}

GROW_TOL = 18.0        # 透明底模式：逐邻居色差阈值（图案是平涂卡通，硬边远大于此）
FLAT_GROW_TOL = 30.0   # 平涂底模式：对整块底取均色的全局色判阈值
SPILL_TOL = 30.0       # 一次性去色溢：贴着背景的像素与背景色的最大距离
SAME_TOL = 34.0        # glow 帧判定「与 normal 同一处内容」的颜色容差
FLAT_BORDER_MIN = 0.72   # 边框不透明比例超过它才可能是「整块残留底」
FLAT_BORDER_SD = 26.0    # 边框颜色标准差小于它才算平涂底色
FLAT_SMOOTH = 40.0       # 3x3 邻域通道起伏之和小于它才算平涂区（卡住描边/木纹/字缘）
GLOW_MARGIN = 5        # glow 画布比 normal 每边多出的像素
FEATHER_PX = 0.85      # alpha 高斯半径：再大就会糊掉「角色」这类细笔画标签
PAD_RATIO = 0.02       # 紧裁后再留一点边，避免羽化过渡被裁掉

# 这四枚不回修现有抠图，而是回参考设计稿重取：它们的毛病是「垃圾在原始轮廓内部」
# （头像圈进椰叶与天空、设置左缘一条椰叶、活动飘带后面一块白纸、钻石坐在棕色圆章上），
# 非破坏性手段去不掉。裁片已存进 tools/badge_matte_src/，工具不依赖会话临时目录。
MOCKUP_SRC = {n: os.path.join(ROOT, 'tools', 'badge_matte_src', n + '-mockup.png')
              for n in ('avatar', 'settings', 'gem')}
# event 试过回参考稿重取，反而更差：飘带与「活动」白字的深色描边紧挨着棕榈叶的深色
# 描边，邻居色差生长会从一条描边跳到另一条，把整条飘带当背景吃掉。它 round-1 的结果
# 只是飘带后面多一块白纸底，图案完整，保留原样。
GLOW_RGB = (255, 233, 160)   # 与其它徽标 glow 帧同色的淡黄高亮
GLOW_PX = 7                  # 合成 glow 描边厚度

# 2026-10-03 生图重做的六枚：金币原来被裁掉半边、活动飘带后面有白纸底、底栏四枚又暗又糊，
# 全部改用 ImageGen 在纯品红底上重画（品红在卡通配色里几乎不出现，是最好的键色），
# 源图缩到 320px 存进 tools/badge_matte_src/。标签不再烤进图里，改由 UI 真文字渲染。
MAGENTA = (255, 0, 255)
KEY_TOL = 90.0
KEY_TOL2 = KEY_TOL * KEY_TOL
# 生图重做的徽标 + 档案面板的 10 枚头像（头像由 tools/slice_grid.py 从一张 2×5 网格图切出来）
ICON_NAMES = ('coin', 'event', 'shop', 'handbook', 'chest', 'character', 'achieve',
              'ava_01', 'ava_02', 'ava_03', 'ava_04', 'ava_05',
              'ava_06', 'ava_07', 'ava_08', 'ava_09', 'ava_10')
ICON_SRC = {n: os.path.join(ROOT, 'tools', 'badge_matte_src', n + '-icon.png')
            for n in ICON_NAMES}
# 键色按素材挑：勋章中央那颗宝石本身就是品红，用粉键会把主体键穿，所以它改成纯蓝底重画。
# 蓝底只给它用——头像里有蓝色衣服、天空蓝底，走粉键才安全。
ICON_KEY = {'achieve': 'blue'}

GROW_TOL2 = GROW_TOL * GROW_TOL
FLAT_GROW_TOL2 = FLAT_GROW_TOL * FLAT_GROW_TOL
SPILL_TOL2 = SPILL_TOL * SPILL_TOL
SAME_TOL2 = SAME_TOL * SAME_TOL
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def dist2(c1, c2):
    return (c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 + (c1[2] - c2[2]) ** 2


def load_rgba(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    return im, [px[x, y] for y in range(h) for x in range(w)]


def neigh(w, h, i):
    x, y = i % w, i // w
    for dx, dy in N4:
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h:
            yield ny * w + nx



def grow(w, h, px, keep, q, accept):
    """连通生长。accept(ref_i, j) 判断「背景里的 ref_i 能否把邻居 j 也判为背景」。"""
    while q:
        i = q.popleft()
        for j in neigh(w, h, i):
            if keep[j] and accept(i, j):
                keep[j] = 0
                q.append(j)


def build_mask(w, h, px, border_seed=False):
    """参考稿裁块专用：从边框起种、按邻居色差生长，返回 1=保留 / 0=背景。

    裁块没有透明外圈可当种子，只能从边框出发；参考稿是平涂卡通，图案边界是硬跳变，
    生长到图案边缘自然停住。
    """
    keep = bytearray(b'\x01' * (w * h))
    q = deque()
    for x in range(w):
        for i in (x, (h - 1) * w + x):
            keep[i] = 0
            q.append(i)
    for y in range(h):
        for i in (y * w, y * w + w - 1):
            keep[i] = 0
            q.append(i)
    grow(w, h, px, keep, q, lambda i, j: dist2(px[i], px[j]) <= GROW_TOL2)
    return keep



def glow_mask(nw, nh, npx, nkeep, gw, gh, gpx):
    """glow 帧掩码由 normal 帧推导：normal 判背景 且 两帧该处同色 => 也是背景。

    normal 的背景区里，残留底在两帧是同一块颜色（判为背景），而 glow 自己那圈高亮
    描边在 normal 处是天空/沙地（颜色不同，判为保留），于是底没了、描边留着。
    """
    keep = bytearray(b'\x01' * (gw * gh))
    for i in range(gw * gh):
        if gpx[i][3] <= 8:
            keep[i] = 0  # 源图本来就透明：它的 RGB 是 (0,0,0)，留着羽化会糊出一圈黑边
            continue
        x, y = i % gw - GLOW_MARGIN, i // gw - GLOW_MARGIN
        if x < 0 or y < 0 or x >= nw or y >= nh:
            continue  # 画布外扩的那 5px 边：属于 glow 描边的活动范围，保留
        j = y * nw + x
        if not nkeep[j] and dist2(gpx[i], npx[j]) <= SAME_TOL2:
            keep[i] = 0
    return keep


def bbox(keep, w, h):
    minx, miny, maxx, maxy = w, h, -1, -1
    for i, k in enumerate(keep):
        if k:
            x, y = i % w, i // w
            minx = min(minx, x); maxx = max(maxx, x)
            miny = min(miny, y); maxy = max(maxy, y)
    if maxx < 0:
        return 0, 0, w, h
    return minx, miny, maxx - minx + 1, maxy - miny + 1


def drop_small_components(w, h, keep, min_frac=0.02, min_px=45):
    """丢掉零散残留小岛，但保留徽标的所有组成部分。

    不能只留最大连通块：底部四格的中文标签、活动/成就徽标下方的飘带都是与主图断开
    的独立块，只留最大块会把它们一起删掉（实测「活动」两字和「商店」标签都因此消失）。
    所以按「相对最大块的面积」设门槛，只滤掉真正的碎屑。
    """
    seen = bytearray(w * h)
    comps = []
    for i in range(w * h):
        if not keep[i] or seen[i]:
            continue
        comp, q = [i], deque([i])
        seen[i] = 1
        while q:
            k = q.popleft()
            for j in neigh(w, h, k):
                if keep[j] and not seen[j]:
                    seen[j] = 1
                    comp.append(j)
                    q.append(j)
        comps.append(comp)
    if not comps:
        return keep
    biggest = max(len(c) for c in comps)
    floor = max(min_px, biggest * min_frac)
    out = bytearray(w * h)
    for c in comps:
        if len(c) >= floor:
            for i in c:
                out[i] = 1
    return out


def synth_glow(im, keep, margin=GLOW_PX + 2, color=GLOW_RGB):
    """由 normal 帧合成 glow 帧：把轮廓向外扩一圈淡黄描边再压上本体。

    头像的旧 glow 帧和 normal 帧一样把棕榈叶圈了进来，没法「修」，只能重做。
    """
    w, h = im.size
    solid = Image.new('L', (w, h))
    solid.putdata([255 if k else 0 for k in keep])
    ring = solid.filter(ImageFilter.MaxFilter(2 * margin + 1)).filter(ImageFilter.GaussianBlur(1.6))
    canvas = Image.new('RGBA', (w + 2 * margin, h + 2 * margin), (0, 0, 0, 0))
    tint = Image.new('RGBA', canvas.size, color + (255,))
    tint.putalpha(ring.resize(canvas.size, Image.LANCZOS))
    canvas.alpha_composite(tint)
    canvas.alpha_composite(im, (margin, margin))
    return canvas


def feather(w, h, keep):
    im = Image.new('L', (w, h))
    im.putdata([255 if k else 0 for k in keep])
    im = im.filter(ImageFilter.GaussianBlur(FEATHER_PX))
    px = im.load()
    return [px[x, y] for y in range(h) for x in range(w)]


def refill(w, h, px, keep, alpha, also=None):
    """过渡带与粘色边缘的颜色由实心区向外逐圈扩散推出。

    also = fringe() 标出的粘色像素：它们仍是不透明的，但颜色要从内部重新推，
    这样蓝天/白边残留被换成图案本色，轮廓尺寸不变。
    """
    out = [(px[i][0], px[i][1], px[i][2]) for i in range(w * h)]
    solid = set(i for i in range(w * h) if keep[i] and alpha[i] > 250 and not (also and i in also))
    # 连「原本透明、被羽化抬出一点 alpha」的像素也要填色：它们的 RGB 是 (0,0,0)，
    # 不填就会在轮廓外糊出一圈黑边
    need = set(range(w * h)) - solid
    frontier = deque(solid)
    for _ in range(6):
        if not need or not frontier:
            break
        nxt = deque()
        for i in frontier:
            for j in neigh(w, h, i):
                if j in need:
                    out[j] = out[i]
                    need.discard(j)
                    nxt.append(j)
        frontier = nxt
    return out


def to_image(w, h, out, alpha):
    im = Image.new('RGBA', (w, h))
    im.putdata([(out[i][0], out[i][1], out[i][2], alpha[i]) for i in range(w * h)])
    return im


def fit_box(x, y, cw, ch, target, pad):
    """紧裁框 + 留边 + 按槽位比例补透明边（居中，不改内容尺度）。"""
    x, y, cw, ch = x - pad, y - pad, cw + 2 * pad, ch + 2 * pad
    if cw / float(ch) < target:
        ncw = int(round(ch * target)); x -= (ncw - cw) // 2; cw = ncw
    else:
        nch = int(round(cw / target)); y -= (nch - ch) // 2; ch = nch
    return x, y, cw, ch


def bbox_of_alpha(im):
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 8:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    if maxx < 0:
        return 0, 0, w, h
    return minx, miny, maxx - minx + 1, maxy - miny + 1


def tile_color(w, h, px, keep):
    """贴着背景的那一圈实心像素若彼此几乎同色，说明徽标坐在一块平涂残留底上。

    底栏四格 = 参考图底栏的棕底整块被裁进来了；钻石 = 它原本坐在一枚圆章上。
    头像/设置那种外圈是「棕榈叶 + 天空 + 深色描边」的，标准差大，不会被误判。
    """
    ring = [px[i] for i in range(w * h)
            if keep[i] and px[i][3] > 8 and any(not keep[j] for j in neigh(w, h, i))]
    if len(ring) < 60:
        return None
    n = len(ring)
    mean = tuple(sum(c[k] for c in ring) / n for k in range(3))
    if (sum(dist2(c, mean) for c in ring) / n) ** 0.5 > FLAT_BORDER_SD:
        return None
    return mean


def _local_flat(px, w, h, i):
    """3x3 邻域内颜色起伏小 = 平涂区。图案的描边、木纹、字缘在这里都会被卡住。"""
    x, y = i % w, i // w
    vals = [px[ny * w + nx] for ny in range(max(0, y - 1), min(h, y + 2))
            for nx in range(max(0, x - 1), min(w, x + 2))]
    spread = 0
    for k in range(3):
        col = [c[k] for c in vals]
        spread += max(col) - min(col)
    return spread <= FLAT_SMOOTH


def remove_flat_tile(w, h, px, keep, flat):
    """从贴背景的那一圈起，吞并「连通 + 贴近底均色 + 局部平坦」的残留底。"""
    q = deque()
    for i in range(w * h):
        if keep[i] and dist2(px[i], flat) <= FLAT_GROW_TOL2 and any(
                not keep[j] for j in neigh(w, h, i)):
            keep[i] = 0
            q.append(i)
    grow(w, h, px, keep, q, lambda i, j: dist2(px[j], flat) <= FLAT_GROW_TOL2
         and _local_flat(px, w, h, j))
    return keep


def base_keep(w, h, px):
    """默认完全信任现有抠图的轮廓：只做边缘质量，不重新推导形状。"""
    return bytearray(1 if px[i][3] > 8 else 0 for i in range(w * h))


def fringe(w, h, px, keep):
    """标出「边缘粘了底色」的像素：贴着背景、且颜色几乎等于旁边那圈背景的原色。

    只标不改掩码 —— 这些像素的颜色会被换成内部色（见 refill），轮廓一个像素都不缩。
    早先版本是直接把这些像素剥掉，结果平涂卡通里「图案浅色面 ≈ 背景色」的情况
    （钻石的亮面 vs 天空蓝、卷轴的纸面 vs 沙地）被一路吃穿，钻石只剩半个 V。
    """
    out = set()
    for i in range(w * h):
        if not keep[i] or px[i][3] <= 8:
            continue
        for j in neigh(w, h, i):
            if not keep[j] and px[j][3] > 8 and dist2(px[i], px[j]) <= SPILL_TOL2:
                out.add(i)
                break
    return out


def key_pink(w, h, px):
    """键掉粉/品红底。生图模型给的「纯品红」其实每张都不一样（实测 (208,65,154) 到
    (246,13,231)），所以不能按与固定色的距离判，要按「粉度」：r、b 都明显高于 g。
    暖色（金/红/棕）的 b<=g，冷色（蓝/绿/紫）的 r-g 不够大，都不会被误判。
    """
    return bytearray(0 if (px[i][0] > px[i][1] + 60 and px[i][2] > px[i][1] + 40
                           and px[i][0] > 140) else 1 for i in range(w * h))


def key_blue(w, h, px):
    """键掉纯蓝底（绿幕思路的蓝版），给「勋章」这类主体自带品红的素材用。

    判据与 key_pink 对称：b 同时明显高于 r、g。金色（b 远小于 r）、红绶带、绿叶、
    深棕描边、白色高光都不满足，只有生图给的蓝底满足。
    """
    return bytearray(0 if (px[i][2] > px[i][0] + 60 and px[i][2] > px[i][1] + 60
                           and px[i][2] > 140) else 1 for i in range(w * h))


KEYERS = {'pink': key_pink, 'blue': key_blue}


def bg_mean(w, h, px, keep):
    """背景均色：反预乘要拿它当键色，用固定 #FF00FF 会在暗粉底上过度校正。"""
    rs = gs = bs = n = 0
    for i in range(w * h):
        if not keep[i]:
            rs += px[i][0]; gs += px[i][1]; bs += px[i][2]; n += 1
    if n == 0:
        return MAGENTA
    return (rs / n, gs / n, bs / n)


def unpremix(w, h, px, alpha, bg):
    """把键色背景上的半透明边缘还原成图案真色：obs = a*true + (1-a)*bg。

    羽化后边缘像素是「图案色与品红按覆盖率混合」的结果，直接留着会有一圈粉边；
    按覆盖率反解即可精确还原，比侵蚀一圈或从内部换色都准。
    """
    out = []
    for i in range(w * h):
        a = alpha[i] / 255.0
        r, g, b = px[i][0], px[i][1], px[i][2]
        if 0.02 < a < 0.98:
            r = int(max(0, min(255, (r - (1 - a) * bg[0]) / a)))
            g = int(max(0, min(255, (g - (1 - a) * bg[1]) / a)))
            b = int(max(0, min(255, (b - (1 - a) * bg[2]) / a)))
        out.append((r, g, b))
    return out


def cut(w, h, px, keep, also=None, bg=None):
    """掩码 -> 成品 RGBA：羽化 + 颜色处理。

    bg 给定（品红键路径）时用反预乘还原边缘真色；否则用 refill 从内部向外推色。
    """
    alpha = feather(w, h, keep)
    colors = unpremix(w, h, px, alpha, bg) if bg is not None else refill(w, h, px, keep, alpha, also)
    return to_image(w, h, colors, alpha)


def source(name):
    """normal 源图：生图重做的走键色路径（粉/蓝，见 ICON_KEY），内容错的回参考稿，其余用现有抠图。"""
    p = ICON_SRC.get(name)
    if p and os.path.exists(p):
        im = Image.open(p).convert('RGBA')
        w, h = im.size
        px = im.load()
        return im, [px[a, b] for b in range(h) for a in range(w)], 'icon'
    p = MOCKUP_SRC.get(name)
    if p and os.path.exists(p):
        im = Image.open(p).convert('RGBA')
        w, h = im.size
        px = im.load()
        return im, [px[a, b] for b in range(h) for a in range(w)], 'mockup'
    p = os.path.join(BADGE_DIR, 'normal', name + '.png')
    if not os.path.exists(p):
        return None, None, None
    im, px = load_rgba(p)
    return im, px, 'badge'


def process(name, out_dir=None):
    nim, npx, kind = source(name)
    if nim is None:
        return 'missing'
    nw, nh = nim.size
    if kind == 'icon':
        # 粉度/蓝度键 + 反预乘还原边缘真色；门槛放低，把角落水印残留这类小碎片滤掉
        nkeep = KEYERS[ICON_KEY.get(name, 'pink')](nw, nh, npx)
        nkeep = drop_small_components(nw, nh, nkeep, min_frac=0.01, min_px=30)
        nimg = cut(nw, nh, npx, nkeep, bg=bg_mean(nw, nh, npx, nkeep))
    elif kind == 'mockup':
        # 参考稿裁块没有透明外圈，只能从边框起种、按邻居色差生长
        nkeep = build_mask(nw, nh, npx)
        # 门槛比徽标路径严：裁块里混进来的椰叶条、邻位星章残边都是几百像素的长条，
        # 2% 滤不掉（实测钻石旁边留了三条叶筋）。这条路径上没有需要保留的独立小部件。
        nkeep = drop_small_components(nw, nh, nkeep, min_frac=0.07)
        nimg = cut(nw, nh, npx, nkeep)
    else:
        # 默认完全信任现有抠图的轮廓：只揭平涂残留底，然后羽化 + 换色去溢。
        # 不再用色差生长重新推导形状 —— 平涂卡通里「图案浅色面 ≈ 背景色」会被吃穿
        # （实测钻石只剩半个 V、卷轴纸面整片消失）。
        nkeep = base_keep(nw, nh, npx)
        flat = tile_color(nw, nh, npx, nkeep)
        if flat:
            nkeep = remove_flat_tile(nw, nh, npx, nkeep, flat)
            nkeep = drop_small_components(nw, nh, nkeep)
        nimg = cut(nw, nh, npx, nkeep, fringe(nw, nh, npx, nkeep))

    frames = {'normal': nimg}
    gpath = os.path.join(BADGE_DIR, 'glow', name + '.png')
    if kind in ('mockup', 'icon'):
        # 这两条路径的旧 glow 帧要么圈进了垃圾、要么根本没有，按同风格重合成描边
        frames['glow'] = synth_glow(nimg, nkeep)
    elif os.path.exists(gpath):
        gim, gpx = load_rgba(gpath)
        gw, gh = gim.size
        gkeep = glow_mask(nw, nh, npx, nkeep, gw, gh, gpx)
        frames['glow'] = cut(gw, gh, gpx, gkeep, fringe(gw, gh, gpx, gkeep))

    tw, th = SLOTS.get(name, (nw, nh))
    sizes = {}
    for frame, img in frames.items():
        # 每帧各用自己的紧框：两帧内容同心，换帧时只有描边那 ~10% 的尺度差（160ms 一闪，
        # 读不出来）。取并集的话 glow 描边会把框撑大 12~30px，等于把所有徽标永久画小。
        x, y, cw, ch = bbox_of_alpha(img)
        cx, cy, cw, ch = fit_box(x, y, cw, ch, tw / float(th),
                                 max(2, int(round(max(cw, ch) * PAD_RATIO))))
        crop = img.crop((cx, cy, cx + cw, cy + ch))
        dst_dir = os.path.join(BADGE_DIR if out_dir is None else out_dir, frame)
        os.makedirs(dst_dir, exist_ok=True)
        crop.save(os.path.join(dst_dir, name + '.png'), optimize=True)
        sizes[frame] = (cw, ch)

    nb = bbox(nkeep, nw, nh)
    nn = sizes['normal']
    ng = sizes.get('glow')
    return '%-6s src %dx%d content %dx%d -> normal %dx%d%s fill %.2f' % (
        kind, nw, nh, nb[2], nb[3], nn[0], nn[1],
        ' glow %dx%d' % ng if ng else '',
        nb[2] * nb[3] / float(max(1, nn[0] * nn[1])))


def inspect(name):
    rows = []
    for frame in ('normal', 'glow'):
        p = os.path.join(BADGE_DIR, frame, name + '.png')
        if not os.path.exists(p):
            continue
        im, px = load_rgba(p)
        w, h = im.size
        solid = sum(1 for c in px if c[3] > 250)
        semi = sum(1 for c in px if 8 < c[3] <= 250)
        rows.append((name, frame, w, h, 100.0 * solid / (w * h), 100.0 * semi / (w * h),
                     tile_color(w, h, px, base_keep(w, h, px))))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--inspect', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--dry-out')
    a = ap.parse_args()
    names = a.only or list(SLOTS.keys())

    if a.inspect:
        print('%-10s %-7s %-10s %8s %7s %s' % ('badge', 'frame', 'size', 'opaque%', 'semi%', 'flat-border'))
        for n in names:
            for r in inspect(n):
                print('%-10s %-7s %-10s %8.1f %7.1f %s' % (
                    r[0], r[1], '%dx%d' % (r[2], r[3]), r[4], r[5],
                    '-' if r[6] is None else '#%02x%02x%02x' % tuple(int(v) for v in r[6])))
        return 0
    if a.apply:
        for n in names:
            print('%-10s %s' % (n, process(n, out_dir=a.dry_out)))
        return 0
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
