/**
 * 相机机位目标（纯函数、无 three 依赖，可回归测试）：地面/空中两套目标派生。
 * 用户反馈（原始）：「飞到天上后视角要往上挪，还要能看见地面障碍和空中金币」。
 * 空中（飞行/滑翔）与地面的差异必须肉眼可辨——PR #7 首版把空中机位设成
 * y*0.55+2.2，和地面 y*0.5+2.7 在 4.6m 飞行高度几乎重合（5.13 vs 5.0），
 * 等于没改；本版把差值拉到 camY +2m / camZ +2.4m / FOV +13°，并压注视点到
 * 地面与角色之间形成俯角，同帧装下地面赛道、角色与空中金币带。
 */

/** 地面机位：T1 审计 Z 7.4→8.4、Y 1.9→2.7；本轮用户要求「地上视角再高一些」
 *  → Y 2.7→3.3、Z 8.4→9.2（俯角 7.9°→9.3°，前方赛道/障碍更早入画，人物不放大） */
export const CAM_Z_GROUND = 9.2, CAM_Y_BASE_GROUND = 3.3, CAM_Y_RATIO_GROUND = 0.5;
/** 空中机位（飞行/滑翔）：4.6m 高度下 camY=7.65、camZ=11.6、lookY=2.09、FOV 68；
 *  地面机位抬高后同步上抬，保持空中/地面肉眼可辨（camY +2.05m / camZ +2.4m / FOV +13°） */
export const CAM_Z_AIR = 11.6, CAM_AIR_Y_BASE = 4.2, CAM_AIR_Y_RATIO = 0.75;
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
