/**
 * 天穹雷脊调色板（docs/stormspire-brief.md §2）：7 色，禁止出圈。
 * 发光物只用熔金电光一种；零默认灰、零纯黑（最暗用深渊靛）。
 * 主题 sky/fog/lighting 在 config/themes.json，这里只管侧景固有色。
 */
export const P = {
  abyss: 0x16233e,      // 深渊靛：天空深处、最暗部
  storm: 0x3d6b8f,      // 风暴青：岩石暗面、雾
  cloud: 0xe9eff3,      // 云白：云顶、高光、鸟腹
  stone: 0x97a0ae,      // 石灰岩：建筑主体
  verdigris: 0x4e9b8f,  // 铜绿：铜环、铜饰、氧化面
  gold: 0xffc145,       // 熔金电光：一切发光物
  moss: 0x6e8f6b,       // 苔灰绿：岛面植被
  /** 派生（调色板内插值，不出圈）：岩体沉积纹 / 雨丝 / 云影 */
  stoneDark: 0x76808f,  // 石灰岩 × 风暴青
  mossDark: 0x55714f,   // 苔灰绿暗面
  rain: 0xafc4d6,       // 云白偏风暴青，雨丝专用
  cloudShade: 0xc4d2dc, // 云白 × 风暴青（云团暗面）
} as const;
