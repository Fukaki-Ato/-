/**
 * 相机机位目标（纯函数、无 three 依赖，可回归测试）：地面/空中两套目标派生。
 * 用户反馈（原始）：「飞到天上后视角要往上挪，还要能看见地面障碍和空中金币」。
 * 空中（飞行/滑翔）与地面的差异必须肉眼可辨——PR #7 首版把空中机位设成
 * y*0.55+2.2，和地面 y*0.5+2.7 在 4.6m 飞行高度几乎重合（5.13 vs 5.0），
 * 等于没改；本版把差值拉到 camY +2m / camZ +2.4m / FOV +13°，并压注视点到
 * 地面与角色之间形成俯角，同帧装下地面赛道、角色与空中金币带。
 */

/** 地面机位：**回退到 main 分支口径**（用户五轮反馈定稿）。
 *  T1 审计 Z 7.4→8.4、Y 1.9→2.7 之后，用户曾三次要求「高一些」（2.7→3.3→4.6、
 *  Z 8.4→11.0→9.2），俯角一路加到 13°；五轮实测后用户判定 main 的人物占比
 *  （相机距人物 8.8m vs 10.3m，人大 14%）与贴脸感更好 → 地面回 main：
 *  Y 4.6→2.7、Z 9.2→8.4（俯角 13.0°→7.9°：前方障碍入画变晚、高速段反应时间
 *  变短、跳跃时近处地面更易滑出画面下沿——均已知并接受）。
 *  注意：空中机位不随此回退。main 的空中机位（y*0.55+2.2）正是 PR #7 评审意见
 *  「与地面几乎重合、视同未通过」的那一版，必须保持可辨差值（见下）。 */
export const CAM_Z_GROUND = 8.4, CAM_Y_BASE_GROUND = 2.7, CAM_Y_RATIO_GROUND = 0.5;
/** 空中机位（飞行/滑翔）：4.6m 高度下 camY=8.75、camZ=11.4、lookY=2.09、FOV 68。
 *  地面回退后与地面的可视差值进一步拉大（camY +3.8m / camZ +3.0m / FOV +13°） */
export const CAM_Z_AIR = 11.4, CAM_AIR_Y_BASE = 5.3, CAM_AIR_Y_RATIO = 0.75;
export const LOOK_AIR_Y_BASE = 0.8, LOOK_AIR_Y_RATIO = 0.28;
/** 视野：地面 55°，空中 68°（高空广角） */
export const FOV_GROUND = 55, FOV_AIR = 68;

export interface CamTargets { camY: number; lookY: number; camZ: number; fov: number }

/** 按角色高度 y 与是否空中，派生机位/注视点/纵深/视野目标（渲染层按 CAM_FOLLOW 平滑过渡） */
export function camTargets(y: number, airborne: boolean): CamTargets {
  if (airborne) {
    return {
      camY: y * CAM_AIR_Y_RATIO + CAM_AIR_Y_BASE,
      lookY: y * LOOK_AIR_Y_RATIO + LOOK_AIR_Y_BASE,
      camZ: CAM_Z_AIR,
      fov: FOV_AIR,
    };
  }
  return {
    camY: y * CAM_Y_RATIO_GROUND + CAM_Y_BASE_GROUND,
    lookY: y * CAM_Y_RATIO_GROUND,
    camZ: CAM_Z_GROUND,
    fov: FOV_GROUND,
  };
}
