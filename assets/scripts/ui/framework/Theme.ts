import { Color } from 'cc';

/**
 * 全局视觉 tokens（docs/04 §1）。
 * 约定：Color 实例只读使用，禁止在业务中直接修改 Theme 内的对象。
 */
export type QualityLevel = 1 | 2 | 3 | 4 | 5;

const QUALITY_COLORS: Record<QualityLevel, Color> = {
  1: new Color(158, 158, 158, 255),
  2: new Color(107, 203, 119, 255),
  3: new Color(77, 150, 255, 255),
  4: new Color(179, 107, 255, 255),
  5: new Color(255, 176, 32, 255),
};

export const Theme = {
  color: {
    // 品牌色（docs/04 §1）
    skyBlue: new Color(78, 195, 247, 255),
    sand: new Color(245, 208, 122, 255),
    wood: new Color(122, 74, 43, 255),
    gold: new Color(255, 197, 61, 255),
    diamond: new Color(90, 210, 244, 255),
    red: new Color(255, 77, 79, 255),

    // 语义色
    panel: new Color(255, 246, 227, 255),
    panelDeep: new Color(240, 217, 168, 255),
    border: new Color(224, 184, 124, 255),
    text: new Color(74, 53, 32, 255),
    textSub: new Color(138, 107, 74, 255),
    textOnDark: new Color(255, 255, 255, 255),
    textDisabled: new Color(184, 169, 149, 255),
    overlay: new Color(0, 0, 0, 140),
    toastBg: new Color(38, 30, 22, 230),
    track: new Color(0, 0, 0, 46),
    placeholder: new Color(159, 182, 195, 255),
    white: new Color(255, 255, 255, 255),

    // 按钮兜底色（素材缺失时）
    btnPrimary: new Color(78, 195, 247, 255),
    btnSecondary: new Color(245, 208, 122, 255),
    btnGreen: new Color(107, 203, 119, 255),
    btnDanger: new Color(255, 77, 79, 255),
  },

  fontSize: {
    title: 48,
    subtitle: 40,
    button: 34,
    body: 28,
    small: 24,
    tiny: 22,
  },

  space: {
    xs: 8,
    sm: 16,
    md: 24,
    lg: 32,
    xl: 48,
  },

  radius: {
    sm: 8,
    md: 16,
    lg: 24,
    pill: 999,
  },

  duration: {
    /** 面板/弹窗打开与关闭时长（docs/04 §1）。 */
    panel: 0.18,
    toastIn: 0.15,
    toastHold: 2,
    toastOut: 0.2,
  },

  size: {
    designWidth: 750,
    designHeight: 1624,
  },

  // 逻辑层级（docs/04 §1），与 UIRoot 层节点顺序一致。
  layerZ: {
    scene: 0,
    panel: 100,
    popup: 200,
    toast: 400,
    loading: 500,
    debug: 900,
  } as const,

  /**
   * 本会话定义的通用资源路径（docs/04 §4.1 约定：位于 assets/resources/，不带扩展名）。
   * 其余资源路径必须来自配置表；面板不得内联写死其它路径。
   */
  assets: {
    bgMain: 'images/bg/main',
    panelCommon: 'images/ui/panel_common',
    btnStart: 'images/ui/btn_start',
    btnPrimary: 'images/ui/btn_primary',
    btnSecondary: 'images/ui/btn_secondary',
    btnGreen: 'images/ui/btn_green',
    iconGold: 'images/ui/icon_gold',
    iconDiamond: 'images/ui/icon_diamond',
    iconSettings: 'images/ui/icon_settings',
    iconActivity: 'images/ui/icon_activity',
    iconTask: 'images/ui/icon_task',
    iconAchievement: 'images/ui/icon_achievement',
    iconRank: 'images/ui/icon_rank',
    iconShop: 'images/ui/icon_shop',
    iconWelfare: 'images/ui/icon_welfare',
    iconWarehouse: 'images/ui/icon_warehouse',
    iconCharacter: 'images/ui/icon_character',
    redDot: 'images/ui/red_dot',
    tabActive: 'images/ui/tab_active',
    tabNormal: 'images/ui/tab_normal',
    progressBg: 'images/ui/progress_bg',
    progressFill: 'images/ui/progress_fill',
    emptyDefault: 'images/ui/empty_default',
    sfxClick: 'audio/sfx/click',
    sfxReward: 'audio/sfx/reward',
    sfxError: 'audio/sfx/error',
    bgmMain: 'audio/bgm/main',
  },
} as const;

export function qualityColor(quality: number): Color {
  const level = Math.round(quality);
  if (level >= 1 && level <= 5) return QUALITY_COLORS[level as QualityLevel];
  return QUALITY_COLORS[1];
}
