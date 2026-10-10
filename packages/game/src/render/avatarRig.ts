/**
 * 角色装配与姿态（render 层）——把模型（程序化 core/character.ts 装配结果 / GLB 装配）摆进场景
 * docs/05 §1 画面支柱②「角色霓虹描边与拖尾」的描边部分在 runnerModel 里，本文件负责：
 *   位置/朝向、四档姿态选择、受击摇晃、以及喷气背包·头盔·护盾三个 buff 挂件。
 * 双路径（决策记录）：
 *   - look.prefab 存在且平台 extras.readBinary 可用 → animAvatar 的 GLB 驱动（char_nailong / char_bball）；
 *     异步加载，加载完成前程序化模型照常可见，就绪即热替换，不阻塞开局；
 *   - 其余一切情况（无 prefab / 无 extras.readBinary / 资源或 clip 不合格）→ 程序化 runnerModel，行为不变。
 * 只读 sim 状态，不反写玩法数据（docs/02 §5 单向数据流）。
 */
import * as THREE from 'three';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import type { Loadout } from '@tr/game/core/sim/character.js';
import type { FxState } from '@tr/game/core/effects/buffEngine.js';
import type { RunnerState } from '@tr/game/core/sim/simTypes.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { createRunnerModel } from './runnerModel.js';
import { createAnimAvatar, type AnimAvatar } from './animAvatar.js';
import { createFootDust } from './footDust.js';

/** 无敌期身体往霓虹色打闪的强度与频率（docs/05 §5 角色放电的最小版本） */
const FLASH_ON = 1.15, FLASH_OFF = 0.1, FLASH_HZ = 30;
/** 换道侧倾系数与受击摆幅 */
const LEAN_PER_M = -0.08, STUN_ROLL = 0.14;
/** 滑翔与飞行时的俯角 */
const PITCH_FLY = 0.85, PITCH_GLIDE = 0.5;
/** 判定「离地」的高度余量（米）：站在支撑面上时 y=支撑面高度，跑动姿态；超出该余量才算腾空 */
const AIRBORNE_EPS = 0.05;

/**
 * 姿态档选择（纯函数，可回归测试）：站在支撑面（地面/车顶/坡道）上就是**跑动**，
 * 只有真正离地才算空中收腿。旧版用绝对高度 y>0.05 判空——站在 2.4m 车顶上会被当成
 * 滞空，播放收腿前倾 Pose，就是用户反馈「在火车上走路动画不正常」的根因。
 */
export function pickAvatarMode(s: RunnerState): 'run' | 'air' {
  return s.y > s.supportY + AIRBORNE_EPS ? 'air' : 'run';
}

/** buff 挂件在 GLB 骨骼上的锚点（骨骼名 + 骨内偏移；奶龙骨骼高度契约：Chest 1.05 / Head 1.45m） */
const VFX_ANCHOR = {
  flame: { bone: 'Chest', offset: new THREE.Vector3(0, 0.35, 0.30) }, // 喷气火焰：背后背包位
  helmet: { bone: 'Head', offset: new THREE.Vector3(0, 0.22, 0) },
  shieldOrb: { bone: 'Chest', offset: new THREE.Vector3(0, 0.05, 0) },
} as const;

export function createAvatar(scene: THREE.Scene, laneWidth: number, look: Loadout, adapter?: PlatformAdapter) {
  const model = createRunnerModel({ body: look.bodyTint, glow: look.emissive, scale: look.modelScale });
  const procGroup = model.group;
  scene.add(procGroup);

  // 喷气背包火焰（fly 原语表现）：挂在雷核背包下方
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.44, 8),
    new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
  flame.rotation.x = Math.PI;
  flame.visible = false;

  // 头盔罩（lifeAdd 原语）
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffd84d, metalness: 0.4, roughness: 0.3, transparent: true, opacity: 0.9, flatShading: true }));
  helmet.visible = false;

  // 护盾罩（shieldAdd 原语；层数>0 时显示，破碎即隐藏）
  const shieldOrb = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(look.emissive), transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending }));
  shieldOrb.visible = false;

  // 三个挂件统一挂到躯干组（body 的本地坐标，root 缩放自动继承）：
  // 随身体起伏/前倾，且死亡翻倒（group.rotation.x = topple）时一起倒，不再只跟位置。
  model.body.add(flame, helmet, shieldOrb);
  flame.position.set(0, 0.6, model.packLocalZ);
  helmet.position.set(0, model.headLocalY, 0);
  shieldOrb.position.set(0, model.chestLocalY, 0);

  // ---------- GLB 驱动（char_nailong / char_bball：look.prefab → animAvatar，10 核心 + 表演 clip） ----------
  // 落脚尘土（render 层）：GLB 路径专属。脚行程被腿长锁死在 0.65m/周期而 12 m/s 下身体前进
  // 6.7m/周期，没有落地反馈就读不出在跑；冲击环贴地随赛道平流，把滑步读成蹬地。
  const dust = createFootDust(scene);
  // 异步热替换：加载完成前 procGroup 照常驱动；任何失败都静默保留程序化路径（见 animAvatar.ts 头）。
  // ?anim= QA 锁由壳层经 adapter.extras.urlParams 注入（wx 无 location.search，缺省 undefined）。
  let glb: AnimAvatar | null = null;
  let glbReady = false;
  let disposed = false; // 迟到装配防护：dispose 之后 GLB 才加载完成时放弃装配（animAvatar isDead）
  const urlParams = adapter?.extras?.urlParams;
  if (look.prefab && adapter) {
    createAnimAvatar(adapter, look.prefab, look.modelScale, urlParams, () => disposed)
      .then(a => {
        if (!a) return;
        if (disposed) { a.dispose(); return; } // 双保险：fetch 期间本局已销毁
        glb = a;
        a.setFootfallHandler((x, y, z) => dust.spawn(x, y, z));
        scene.add(a.group);
        // 挂件从程序化躯干迁到骨骼：GLB 姿态由 clip 驱动，挂件必须跟着骨骼走才不漂移
        for (const mesh of [flame, helmet, shieldOrb]) model.body.remove(mesh);
        for (const [key, anchor] of Object.entries(VFX_ANCHOR)) {
          const mesh = { flame, helmet, shieldOrb }[key as keyof typeof VFX_ANCHOR];
          const bone = a.getBone(anchor.bone);
          (bone ?? a.group).add(mesh);
          mesh.position.copy(anchor.offset);
        }
        procGroup.visible = false;
        glbReady = true;
      })
      .catch(() => { /* createAnimAvatar 内部已 resolve(null)，这里只是双保险 */ });
  }

  return {
    /** 当前可见的角色组（GLB 就绪后是 gltf.scene，否则程序化模型） */
    get group() { return glbReady && glb ? glb.group : procGroup; },
    /** 胸口世界高度：爆点、护盾等表现对齐到这里，而不是对齐脚底 */
    get chestY() { return glbReady && glb ? glb.chestY : model.chestY; },
    /** 局末释放：停 GLB 混流器（几何体由 runnerScene 统一 traverse 销毁） */
    dispose() { glb?.dispose(); dust.dispose(); },
    /** @param dt 帧间隔（秒），驱动 GLB 混流器 */
    update(s: RunnerState, fx: FxState, dt = 1 / 60) {
      const stunned = s.stunT > 0;
      const flash = (s.invulnT > 0 || fx.invincible) ? (Math.sin(s.t * FLASH_HZ) > 0 ? FLASH_ON : FLASH_OFF) : 0;
      const lean = (s.lane * laneWidth - s.x) * LEAN_PER_M + (stunned ? Math.sin(s.t * 26) * STUN_ROLL : 0);
      const flying = fx.flyT > 0;

      if (glbReady && glb) {
        // 先落位再跑混流器：animAvatar 的落脚探测读的是本帧脚世界坐标，
        // 旧顺序（先 update 后 setPosition）会让尘土每晚一帧、12 m/s 下偏 0.2m。
        glb.group.position.set(s.x, s.y, 0);
        glb.group.rotation.z = lean;
        glb.update(dt, s, fx);
        // 不写 rotation.x：飞行/滑翔俯角与死亡翻倒做在 clip 里，外层再叠会拧成扭曲姿勢
        glb.group.traverse(o => {
          const m = (o as THREE.Mesh).material;
          for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
            if ((mat as THREE.MeshStandardMaterial).emissive) {
              (mat as THREE.MeshStandardMaterial).emissiveIntensity = flash; // 无敌期打闪（程序化路径走 bodyMat）
            }
          }
        });
      } else {
        const mode: 'run' | 'air' | 'slide' | 'fly' = flying ? 'fly' : s.sliding ? 'slide' : pickAvatarMode(s);
        model.update(s.t, s.distance, mode, stunned ? 0.35 : 1, flash);

        procGroup.position.set(s.x, s.y, 0);
        procGroup.rotation.z = lean;
        // 死亡：整人绕脚底翻倒（docs/01 §8 失败动画=被电麻定住后翻倒，不做受伤表现）
        if (!s.alive) procGroup.rotation.x = s.topple;
        else if (flying) procGroup.rotation.x = PITCH_FLY * 0.35;
        else if (s.gliding) procGroup.rotation.x = PITCH_GLIDE * 0.3;
        else procGroup.rotation.x = 0;
      }

      flame.visible = flying || s.gliding;
      if (flame.visible) {
        const fs = 0.7 + Math.sin(s.t * 22) * 0.2;
        flame.scale.set(fs, 0.7 + fs * 0.4, fs);
      }
      helmet.visible = fx.helmetT > 0;
      shieldOrb.visible = fx.shieldLayers > 0;
      if (shieldOrb.visible) shieldOrb.scale.setScalar(1 + 0.05 * Math.sin(s.t * 6)); // 缓慢呼吸感
      // 尘土平流速度用 sim 步长精确推导（distance/prevDistance 是同一步的前后值），
      // 不用渲染 dt 估：估慢了尘土会飘在角色前面，估快了被地面甩掉。
      dust.update(dt, (s.distance - s.prevDistance) / STEP_DT);
    },
  };
}
