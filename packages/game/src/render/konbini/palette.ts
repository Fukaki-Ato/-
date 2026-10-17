/**
 * 雨夜便利店街角用的调色板（三渲二配色，全部程序化顶点色，零贴图）。
 * 口径：body 桶受光、会被「夜景总曝光」整体乘暗（见 kit.toonMats），所以这里按白天该是什么色就写什么色，
 * 夜晚感由曝光旋钮统一给；glow 桶自发光不吃光，写亮色就是霓虹与店内灯。
 */
export const C = {
  /** 正方形底座：顶面即人行道，侧边深色显出厚度（可收藏模型感就靠这条边） */
  plate: '#8d93a3', plateEdge: '#1b2029', walkSeam: '#767d8d', curb: '#aab0bd',
  road: '#3c414e', roadDark: '#333845', paint: '#e8ecf3', drain: '#2a2f3a',

  /** 店体：白瓷砖墙 + 青/橙两条横饰带 + 深色窗框（框就是「轮廓线」） */
  wall: '#eef2f6', wallShade: '#cdd6e0', band1: '#3fb9a8', band2: '#f2a04a',
  frame: '#242a36', roof: '#5b6472', metal: '#8e97a6', dark: '#1b2029', wood: '#a8794f',

  /** 玻璃与灯光 */
  glass: '#bfe0f5', warm: '#ffe6bd', warmMid: '#ffcf85', coolWhite: '#eaf4ff',
  neonA: '#7fe3ff', neonB: '#ff9ecb', neonC: '#ffe07f', neonD: '#9d7bff',

  /** 店内陈设（货架/饮料柜/便当/关东煮/海报） */
  shelf: '#dfe6ee', prod1: '#e8654f', prod2: '#f2b134', prod3: '#5aa9e6', prod4: '#7bc96f',
  prod5: '#c86fd0', fridge: '#cfe3f0', boxBlue: '#3f7fbf', oden: '#ffb45e',

  /** 花园与远景：高层居民楼三套型各一档深蓝灰（比 10-12 那版再往蓝推一点），窗光统一压暗 */
  green: '#4f7a52', greenDark: '#3a5c40', leaf: '#63a05f', flower: '#e87f9b', flower2: '#f2c14e',
  farA: '#3a4859', farB: '#33404f', farC: '#425163', farCap: '#232b36', farLit: '#9c8f76', farCool: '#63737f', farDark: '#252d38',

  /** 临街商铺排：深蓝灰低饱和墙体 + 深灰平顶 + 淡蓝/暖白发光字 + 柔和暖黄橱窗
   *  墙比远景楼亮一档（楼在 26m 外要压住地平线，铺面在 45~65m 要读得出体块） */
  shopA: '#556375', shopB: '#4e5c6f', shopC: '#5d6b7d', shopRoof: '#333a45', shopTrim: '#282f3a',
  shopSill: '#66737f', shopPipe: '#68757f',
  walkBlue: '#5b6577', walkBlueSeam: '#4a5364', curbStone: '#727d8d', shoulder: '#475163',
  /** 小道与「湿地上那摊光」：小道比人行道亮一档（同族蓝灰，读得出是另一种铺法）；
   *  光摊走 glow 桶（自发光、不乘曝光），所以这里写的就是夜里最终看到的颜色，必须比路面亮才像灯。 */
  path: '#6d7787', pathSeam: '#556072', wetWarm: '#6f6046', wetCool: '#4f6076', wetNeon: '#46586e',
  winWarm: '#f0c285', winSoft: '#d4a76c', winDark: '#2a3340', adGlow: '#cfe3ef',
  signFace: '#2f4a63', signBlue: '#8fd8fb', signWarm: '#fff0d2',
  canopy: '#bfe2f7', lampGrey: '#6a7482', lampDark: '#454d59', warmPool: '#ffd9a8',
  shelterMetal: '#9aa4b2', binDark: '#262d36', bollA: '#e8873c', bollB: '#f2efe6',
  /** 商铺排后方的餐厅与广场：浅米 + 暖木 + 四坡顶；广场浅灰/浅棕拼花 + 石材 + 水面
   *  （body 桶会统一乘夜景曝光，这里写的是白天色，夜里自动压成暖米/浅灰） */
  restWall: '#d8cbb2', restWall2: '#cbbda2', restWood: '#a8794f', restRoof: '#6d5744',
  plazaA: '#aab1bc', plazaB: '#bda887', plazaSeam: '#8f959f', stone: '#9aa2ad',
  water: '#4e8fa8', jet: '#bfe6f2',
} as const;

/** 常用姿态：躺平（把圆柱变成轮子/横管）、竖直转向 */
export const R90 = Math.PI / 2;
