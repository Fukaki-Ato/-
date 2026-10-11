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

  /** 花园与远景 */
  green: '#4f7a52', greenDark: '#3a5c40', leaf: '#63a05f', flower: '#e87f9b', flower2: '#f2c14e',
  farA: '#2b3348', farB: '#232a3c', farWin: '#ffd9a0', farNeon: '#6fd0ff',
} as const;

/** 常用姿态：躺平（把圆柱变成轮子/横管）、竖直转向 */
export const R90 = Math.PI / 2;
