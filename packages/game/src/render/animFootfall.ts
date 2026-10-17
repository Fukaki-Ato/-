/**
 * 落脚探测与尘土触发（render 层解释，零玩法影响）。
 * 从 animAvatar.ts 拆出（该文件因此撞 300 行架构上限）。职责单一：判断「这一帧脚是否
 * 完成了一次蹬地」——进入触地区记进入时的水平位置，离开触地区且水平向前迈过 > 0 才算
 * 一次落脚，由调用方（avatarRig 的 footDust）放尘土。
 *
 * 阈值口径：FOOT_ENTER_Y=0.24 是按奶龙脚程（脚最低 0.137m、抬起 0.29~0.43m）定的触地区
 * 上沿。企鹅等短腿角色放大后脚骨全程摸不到该值（实测 0.06~0.105m）——固定阈值下双脚
 * 永远不进/出触地区、尘土一次不喷。因此按本资产 Run 的量程做自适应兜底：量程跨不过
 * 默认阈值时取量程中点（仅此时生效，长腿角色行为逐字节不变）。
 */
import * as THREE from 'three';

/** 落脚触地区默认阈值（米，相对支撑面）：奶龙脚程定标 */
const FOOT_ENTER_Y = 0.24;
/** 尘土生成高度相对支撑面的抬升（米）：贴地但不穿进地面 */
const DUST_LIFT_Y = 0.03;
/** 自适应测量时的采样点数（一个 Run 周期足够） */
const SAMPLE_N = 24;

export interface FootfallProbe {
  /** 每帧调用（仅在 Run clip 且已设 handler 时有意义）；内部完成进入/离开判定并触发 */
  update(dt: number, supportY: number, feet: { L: THREE.Vector3; R: THREE.Vector3 }, onStep: (x: number, y: number, z: number) => void): void;
  /** 非 Run 帧调一次：清记忆，回来时不补发过期蹬地 */
  reset(): void;
  /** 本资产实际生效的阈值（探针取证用） */
  readonly enterY: number;
}

/**
 * @param mixer 角色动画混合器（阈值测量要用）
 * @param runAct 放大后的 Run 动作（局内实际播放的那条；量程按它算）
 * @param root 角色组（更新世界矩阵用）
 * @param bones 骨骼名 → Object3D（取 FootL/FootR）
 */
export function createFootfallProbe(
  mixer: THREE.AnimationMixer, runAct: THREE.AnimationAction, root: THREE.Object3D,
  bones: Map<string, THREE.Object3D>,
): FootfallProbe {
  const inContact = { L: false, R: false };
  const entryZ = { L: 0, R: 0 };

  /** 把放大后的 Run 过一遍采样 FootL/FootR 的世界 y 量程，定本资产的触地区阈值 */
  function measureEnterY(): number {
    const footL = bones.get('FootL'), footR = bones.get('FootR');
    if (!footL && !footR) return FOOT_ENTER_Y;
    const clip = runAct.getClip();
    runAct.reset();
    runAct.play();
    let lo = Infinity, hi = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < SAMPLE_N; i++) {
      mixer.setTime(clip.duration * i / SAMPLE_N);
      root.updateMatrixWorld(true);
      for (const b of [footL, footR]) {
        if (!b) continue;
        const y = b.getWorldPosition(v).y;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    runAct.stop();
    runAct.reset();
    if (!Number.isFinite(lo) || hi - lo < 1e-4) return FOOT_ENTER_Y;
    return hi < FOOT_ENTER_Y ? (lo + hi) / 2 : FOOT_ENTER_Y;
  }
  const enterY = measureEnterY();

  return {
    enterY,
    update(_dt, supportY, feet, onStep) {
      for (const key of ['L', 'R'] as const) {
        const p = feet[key];
        if (p.y < supportY + enterY) {
          if (!inContact[key]) { inContact[key] = true; entryZ[key] = p.z; }
        } else if (inContact[key]) {
          inContact[key] = false;
          // 必须向前迈过（进入触地后水平位置前移）才算蹬地，防空中收腿误触发
          if (p.z - entryZ[key] > 0) onStep(p.x, supportY + DUST_LIFT_Y, p.z);
        }
      }
    },
    reset() { inContact.L = false; inContact.R = false; },
  };
}
