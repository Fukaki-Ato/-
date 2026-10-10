/**
 * 白日海景场景调色板（三渲二·日式治愈向：通透、柔和、干净）。
 * 与雨夜那套的口径差别：这里是白天，受光桶几乎不压暗（exposure≈1.05），
 * 颜色按「动画赛璐珞」取色——高明度奶白墙、清透蓝玻璃、暖沙与深蓝海面对比，
 * 描边靠深色框件（frame）而不是后处理边缘检测。
 */
export const P = {
  /** 正方形海景平台底座：奶白铺地 + 木露台 + 深色裙边 */
  deck: '#f2e7d3', deckSeam: '#dccdb2', deckEdge: '#8f8271', wood: '#d0a06a', woodDark: '#a3764a',

  /** 别墅本体 */
  wall: '#fdfaf3', wallShade: '#e8dfd0', roof: '#6f8f9d', roofDark: '#52707d',
  frame: '#3b4653', beam: '#ffffff', glass: '#bfe7f2', rail: '#f7f7f5',

  /** 室内（暖、亮、满） */
  floor: '#f7e9d0', rug: '#efd7b4', sofa: '#f0a08a', sofaCool: '#8dc3da', cushion: '#fff3e0',
  table: '#cf9f68', book: ['#e8735f', '#f0c04a', '#6fb6dd', '#7fc98a', '#c07fd0'],
  lampWarm: '#fff0cc', strip: '#ffe3ae', art: ['#9fd8ea', '#ffc7b0', '#c9e8b8'], curtain: '#fbf3e6',
  plant: '#5fae6a', pot: '#d98d5f',

  /** 海、沙、礁石 */
  sand: '#f6e5bd', sandWet: '#dcc596', sandShade: '#e6d2a6',
  sea: '#2f86c4', seaLight: '#6fc6e3', seaDeep: '#1b5f96', foam: '#ffffff',
  rock: '#93a0a8', rockDark: '#6f7b84', rockWet: '#5d6a73',

  /** 植物与遮阳具 */
  palmTrunk: '#b98a5c', palmTrunkDark: '#946c46', leaf: '#54ac6d', leafDark: '#3d8752', coco: '#7c4f2b',
  grass: '#7cc474', grassDark: '#4f8f5b', leafLite: '#68b873', flower: '#ff9fb2', flower2: '#ffd86b',
  umbrella: '#ff8d76', umbrellaTop: '#fff4e8', lounger: '#f6d98a', loungerFrame: '#e6e6e2',

  /** 空气感 */
  mist: '#e4f3fa', haze: '#cfe9f6',
} as const;

export const R90 = Math.PI / 2;
