/**
 * 失重图书馆调色板（docs/scenes/library-brief.md §2）：7 色，禁止出圈。
 * 发光物只用烛光琥珀一种；零默认灰、零纯黑（最暗用墨渊）。
 * 主题 sky/fog/lighting 在 config/themes.json，这里只管侧景固有色。
 */
export const P = {
  abyss: 0x1e1a33,     // 墨渊：墨海深处、天空底色、最暗部（零纯黑的底线值）
  teal: 0x46536b,      // 墨青：雾色、书塔暗面、墨瀑体色
  cream: 0xeadfc2,     // 陈纸米：书页、纸面高光、书塔亮层、纸鹤主体
  tan: 0xb3a17f,       // 纸灰褐：旧纸暗面、折角、磨损页缘
  leather: 0x7a5a3c,   // 皮革棕：装帧皮面、层板、塔基木构、黄铜件暗部
  wax: 0xa63a2e,       // 蜡封红：蜡封章、书签丝带、书脊标签——结构色，不发光
  amber: 0xffb65c,     // 烛光琥珀：唯一发光色（灯笼、章纹微光、光尘、灯池）
  /** 派生（调色板内插值，不出圈，同 stormspire/palette.ts 做法）：页尘白 / 墨雾 / 纸影深 */
  pageDust: 0xf4ecd9,  // 页尘白：翻页波亮带
  inkMist: 0x39445c,   // 墨雾：墨青 × 陈纸（墨雾带 / 墨团）
  paperShade: 0x8f7c5c, // 纸影深：层板阴影面
} as const;
