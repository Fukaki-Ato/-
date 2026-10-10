/**
 * 动画步态放大（render 层解释器，资产零改动）
 *
 * 背景（实测）：奶龙 v8 的 Run take 是慢跑规格——一个周期双脚各前后 0.42~0.49m、抬脚 0.13~0.16m，
 * 脚总行程 ~0.45m，适合 ~1.5~3 m/s。而本局 baseSpeed=12 m/s（gameplay 数值，config 管，禁改），
 * 一个周期身体前进 6.7m 而脚只走 0.65m：脚相对地面 90% 在滑，原样播就是「人在飞、腿在原地倒腾」。
 * 建模侧重导出 sprint cycle 前，这里把 Run 的四肢摆动绕各骨均值放大，让步幅与速度重新对上。
 * 注意幅度不是越大越好：摆腿幅度 × 播放倍率共同决定脚峰值速度，过大叠成「甩腿风车」
 * （用户原话：播放太快、又不明显、显得很丑），定档见 RUN_BONE_AMPS 注释。
 *
 * 实现口径：
 *   - 只放大四元数旋转轨道的「相对均值的偏差」：q' = mean * (mean⁻¹·q)^amp（轴角放大），
 *     amp=1 恒等；均值=符号对齐后的关键帧均值（循环轨道的近似静止姿）。
 *   - position 轨道（Root/Hips 的髋沉、根位移）一律不碰：整角色平移放大就会飘/陷地。
 *   - 只处理 boneAmps 列出的骨骼；其它 clip（Idle/Jump/Land/Death…）完全不放大，逐字节返回原 clip。
 *   - 用欧拉角不安全：本骨架右腿 Euler.x 在 ±π 附近反复横跳（轴倾斜导致分解病态），
 *     四元数偏差没有这个 wrap 问题。
 */
import * as THREE from 'three';

/** 单个骨骼的放大系数（1=原样）。腿是主诉求，手臂保持同侧对位略放大就够 */
export type BoneAmps = Readonly<Record<string, number>>;

/**
 * Run clip 的默认放大表。
 * 定档经过两轮实测扫描（第一轮 1.8/2.2/2.6/3.0 定 2.2，第二轮配 TS_MAX 1.8→1.4 重扫后回调）：
 *   - 2.2× 配 1.8× 播放 = 脚峰值速度 11~12 m/s（和角色自身前进速度一样快），
 *     用户实机判定「播放太快、看不清、很丑」——大幅摆腿 + 高步频叠成甩腿风车；
 *   - 本轮 TS_MAX 降到 1.4（步频 2.4Hz→1.9Hz，接近 12 m/s 真实冲刺步频 ~2.2Hz），
 *     同档振幅不再抽帧，回调到 1.9 后脚峰值速度 7.4~7.9 m/s（-35%），
 *     行程 0.642/0.572m、抬脚 0.292/0.386m、左右交替 corr≈-0.97、脚最低点 0.137m 不陷地。
 * 脚 1.75（行程在 1.8 以上已饱和，放大踝关节只为摆得更开）、臂 1.35（保持对侧对位，不过界）。
 */
export const RUN_BONE_AMPS: BoneAmps = Object.freeze({
  LegUpperL: 1.9, LegUpperR: 1.9, LegLowerL: 1.9, LegLowerR: 1.9,
  FootL: 1.75, FootR: 1.75,
  ArmUpperL: 1.35, ArmUpperR: 1.35, ArmLowerL: 1.35, ArmLowerR: 1.35,
});

const EPS = 1e-9;

/** 把 track 名拆成 [节点名, 属性名]；'LegUpperL.quaternion' → ['LegUpperL','quaternion'] */
function splitTrackName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, ''];
}

/**
 * 符号对齐后的四元数均值（q 与 -q 同旋转，直接平均会抵消成 0；逐帧与累计均值点积定符号）。
 * 全链路近单位四元数（无旋转）时退化为第 0 帧。
 */
export function meanQuaternion(qs: readonly THREE.Quaternion[]): THREE.Quaternion {
  const acc = new THREE.Quaternion(0, 0, 0, 0);
  for (const q of qs) {
    const dot = acc.x * q.x + acc.y * q.y + acc.z * q.z + acc.w * q.w;
    const s = acc.x === 0 && acc.y === 0 && acc.z === 0 && acc.w === 0 ? 1 : (dot < 0 ? -1 : 1);
    acc.x += s * q.x; acc.y += s * q.y; acc.z += s * q.z; acc.w += s * q.w;
  }
  const len = Math.hypot(acc.x, acc.y, acc.z, acc.w);
  if (len < EPS) return qs[0].clone();
  return acc.set(acc.x / len, acc.y / len, acc.z / len, acc.w / len).normalize();
}

/**
 * 绕 ref 放大 q 的相对旋转 amp 倍：q' = ref * (ref⁻¹·q)^amp（轴角直接放大，支持 amp>1 外插）。
 * q 与 -q 是同一旋转：rel.w<0（4D 长弧表示）时先翻到短弧再放大。否则 angle>π 会让下面
 * 「接近 π」的守卫恒真、这些键被静默跳过放大——真实资产已命中过（nailoong.glb 的 Run
 * 里 LegUpperR 30 键有 14 键是反号存储，修复前右腿整段摆幅没被放大、步幅比左腿窄 12%）。
 * 接近 ref（相对角 <1e-4 rad）或相对角接近 π（轴不稳定）时原样返回——单帧无偏差可放，
 * 轴病态帧放大会把姿势炸掉。
 */
export function amplifyQuaternion(
  ref: THREE.Quaternion, q: THREE.Quaternion, amp: number, out: THREE.Quaternion,
): THREE.Quaternion {
  const rel = ref.clone().invert().multiply(q).normalize();
  if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w); // 取短弧表示（同旋转的另一符号）
  const w = Math.min(1, Math.max(-1, rel.w));
  const angle = 2 * Math.acos(w);
  if (angle < 1e-4 || Math.PI - angle < 1e-4) return out.copy(q);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  const a2 = angle * amp;
  const sinA = Math.sin(a2 / 2);
  const r2x = sinA * rel.x / s, r2y = sinA * rel.y / s, r2z = sinA * rel.z / s, r2w = Math.cos(a2 / 2);
  // out = ref * r2（四元数乘法）
  const rx = ref.x, ry = ref.y, rz = ref.z, rw = ref.w;
  return out.set(
    rw * r2x + rx * r2w + ry * r2z - rz * r2y,
    rw * r2y - rx * r2z + ry * r2w + rz * r2x,
    rw * r2z + rx * r2y - ry * r2x + rz * r2w,
    rw * r2w - rx * r2x - ry * r2y - rz * r2z,
  ).normalize();
}

/** 该 clip 是否有任何骨骼需要放大（amp 全 ≤1 或空表 → 不需要） */
export function needsAmplify(amps: BoneAmps): boolean {
  return Object.values(amps).some(v => v > 1);
}

/**
 * 返回放大后的新 clip（原 clip 与 tracks 数组均不被修改；无命中骨骼时逐字节返回原 clip）。
 * @param clip 源动画 @param amps 骨骼名 → 放大系数
 */
export function amplifyClipSwing(clip: THREE.AnimationClip, amps: BoneAmps): THREE.AnimationClip {
  if (!needsAmplify(amps)) return clip;
  const newTracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const [node, prop] = splitTrackName(t.name);
    const amp = prop === 'quaternion' ? amps[node] : undefined;
    if (!amp || amp <= 1) { newTracks.push(t); continue; }
    if (!(t instanceof THREE.QuaternionKeyframeTrack)) { newTracks.push(t); continue; }
    const vals = t.values;
    const n = vals.length / 4;
    const qs: THREE.Quaternion[] = [];
    for (let i = 0; i < n; i++) qs.push(new THREE.Quaternion().fromArray(vals, i * 4));
    const ref = meanQuaternion(qs);
    const out = new Float32Array(vals.length);
    const tmp = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      amplifyQuaternion(ref, qs[i], amp, tmp);
      tmp.toArray(out, i * 4);
    }
    newTracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, out));
  }
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}
