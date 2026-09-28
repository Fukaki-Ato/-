/**
 * 角色装配与姿态（render 层）——把程序化模型 core/character.ts 的装配结果摆进场景
 * docs/05 §1 画面支柱②「角色霓虹描边与拖尾」的描边部分在 runnerModel 里，本文件负责：
 *   位置/朝向、四档姿态选择、受击摇晃、以及喷气背包·头盔·护盾三个 buff 挂件。
 * 只读 sim 状态，不反写玩法数据（docs/02 §5 单向数据流）。
 */
import * as THREE from 'three';
import type { Loadout } from '@tr/game/core/sim/character.js';
import type { FxState } from '@tr/game/core/effects/buffEngine.js';
import type { RunnerState } from '@tr/game/core/sim/simTypes.js';
import { createRunnerModel } from './runnerModel.js';

/** 无敌期身体往霓虹色打闪的强度与频率（docs/05 §5 角色放电的最小版本） */
const FLASH_ON = 1.15, FLASH_OFF = 0.1, FLASH_HZ = 30;
/** 换道侧倾系数与受击摆幅 */
const LEAN_PER_M = -0.08, STUN_ROLL = 0.14;
/** 滑翔与飞行时的俯角 */
const PITCH_FLY = 0.85, PITCH_GLIDE = 0.5;

export function createAvatar(scene: THREE.Scene, laneWidth: number, look: Loadout) {
  const model = createRunnerModel({ body: look.bodyTint, glow: look.emissive, scale: look.modelScale });
  const group = model.group;
  scene.add(group);

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

  return {
    group,
    /** 胸口世界高度：爆点、护盾等表现对齐到这里，而不是对齐脚底 */
    get chestY() { return model.chestY; },
    update(s: RunnerState, fx: FxState) {
      const mode: 'run' | 'air' | 'slide' | 'fly' =
        fx.flyT > 0 ? 'fly' : s.sliding ? 'slide' : s.y > 0.05 ? 'air' : 'run';
      const stunned = s.stunT > 0;
      model.update(s.t, s.distance, mode, stunned ? 0.35 : 1, (s.invulnT > 0 || fx.invincible) ? (Math.sin(s.t * FLASH_HZ) > 0 ? FLASH_ON : FLASH_OFF) : 0);

      group.position.set(s.x, s.y, 0);
      group.rotation.z = (s.lane * laneWidth - s.x) * LEAN_PER_M + (stunned ? Math.sin(s.t * 26) * STUN_ROLL : 0);
      // 死亡：整人绕脚底翻倒（docs/01 §8 失败动画=被电麻定住后翻倒，不做受伤表现）
      if (!s.alive) group.rotation.x = s.topple;
      else if (fx.flyT > 0) group.rotation.x = PITCH_FLY * 0.35;
      else if (s.gliding) group.rotation.x = PITCH_GLIDE * 0.3;
      else group.rotation.x = 0;

      const flying = fx.flyT > 0;
      flame.visible = flying || s.gliding;
      if (flame.visible) {
        const fs = 0.7 + Math.sin(s.t * 22) * 0.2;
        flame.scale.set(fs, 0.7 + fs * 0.4, fs);
      }
      helmet.visible = fx.helmetT > 0;
      shieldOrb.visible = fx.shieldLayers > 0;
      if (shieldOrb.visible) shieldOrb.scale.setScalar(1 + 0.05 * Math.sin(s.t * 6)); // 缓慢呼吸感
    },
  };
}
