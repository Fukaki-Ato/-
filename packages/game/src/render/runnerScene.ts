/**
 * 跑酷局渲染场景（render 层总装，docs/02 §5）
 * 本文件只做三件事：搭 Three.js 舞台、按固定步长推进 sim 并用插值 alpha 渲染、把事件翻成表现反馈。
 * 具体表现拆在同目录模块里：trackVisuals（道路）/ avatarRig（角色）/ coinField（金币）/
 * entityLayers（障碍·道具箱·云）/ vfxBurst（爆点）/ runDebugProbe（?debug 自动化探针）。
 * 铁律：只读 sim 状态，不反写玩法数据（单向数据流）。
 */
import * as THREE from 'three';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { GLCanvas, PlatformAdapter, WindowSize } from '@tr/framework/platform/platformAdapter.js';
import { createAvatar } from './avatarRig.js';
import { createCoinField } from './coinField.js';
import { createCloudLayer, createObstacleLayer, createPickupLayer } from './entityLayers.js';
import { installRunProbe, uninstallRunProbe } from './runDebugProbe.js';
import { createSpeedLines } from './speedLines.js';
import { createTrackVisuals } from './trackVisuals.js';
import { createBurstPool } from './vfxBurst.js';

export interface RunCallbacks {
  onHud(h: {
    score: number; coins: number; distance: number; hits: number; lives: number;
    buffs: { name: string; left: number }[];
    skill: { label: string; energy: number; cd: number; ready: boolean } | null;
  }): void;
  onEnd(summary: ReturnType<RunnerSim['summary']>): void;
  debug?: boolean;
}

/** 相机参数（docs/02 §8：跟随人物但不 1:1 抬高，否则近处地面会翻出画面下沿）
 *  审计 T1：机位抬高后拉（Z 7.4→8.4、Y 1.9→2.7）并把 lookY 随动降到 0.5，
 *  跳跃时前方金币仍在画面内，人物略靠后。 */
const CAM_Z = 8.4, CAM_Y_BASE = 2.7, CAM_FOLLOW = 0.25, CAM_Y_RATIO = 0.5, LOOK_AHEAD_Z = -11;
/** 飞行/滑翔机位（审计 T2）：独立目标，更高更远、注视点抬高，保证金币与云在画面里；过渡仍走 CAM_FOLLOW */
const CAM_AIR_Y_RATIO = 0.55, CAM_AIR_Y_BASE = 2.2, LOOK_AIR_Y_RATIO = 0.35, LOOK_AIR_Y_BASE = 0.4;
const FOV_GROUND = 55, FOV_AIR = 64, FOV_LERP = 0.06;
/** 加速（speedMul>1）的视野扩张：按 (speedMul-1) 线性加宽并封顶（雷霆冲刺一类技能要看得见加速） */
const SPEED_FOV_PER_MUL = 70, SPEED_FOV_MAX = 10;
/** 震屏：每帧衰减量与随机幅度 */
const SHAKE_DECAY = 1 / 60, SHAKE_AMP = 0.24;
/** 死亡后停留多久进结算页、HUD 刷新间隔（秒） */
const END_DELAY_S = 1.2, HUD_INTERVAL_S = 0.15;
/** 爆点的画面深度（角色身体前方 0.62m，胸口高度由 chestY 提供）；穿云用白色 */
const BURST_Z = -0.62, CLOUD_BURST_COLOR = 0xdfe9f5;
/** 雾视距：障碍在约 3 秒外可见（地铁酷跑式远望） */
const FOG_NEAR = 22, FOG_FAR = 120;

export function createRunnerScene(
  host: { canvas: GLCanvas; size: WindowSize },
  adapter: PlatformAdapter, sim: RunnerSim, content: GameContent, cb: RunCallbacks,
) {
  const runner = (content.game.params.runner ?? {}) as Record<string, number>;
  const laneWidth = runner.laneWidth ?? 2.2;
  /** 滑翔倒计时换算：core 以 heightM/glideS 匀速下降（movement.ts），HUD 显示与 s.gliding 一致的真实剩余秒数 */
  const flight = (content.game.params.flight ?? {}) as Record<string, number>;
  const glideFallMps = (flight.heightM ?? 4.6) / (flight.glideS ?? 1.8);
  const theme = (content.themes.items ?? []).find(t => t.id === 'theme_neon_city');
  const sky = (theme?.sky ?? { baseColor: '#0B1226', flashColor: '#9FD8FF' }) as { baseColor: string; flashColor: string };
  const tint = (theme?.vfxTint as string | undefined) ?? '#7FD1FF';
  /** buff 派生视图：引擎原地更新同一个对象，渲染层缓存引用安全（docs/09 T2.2） */
  const fx = sim.fx;

  // ---------- 舞台 ----------
  // 全仓唯一 three 接线断言点（S10 §7.6 / D3）：GLCanvas 是结构化去 DOM 类型，
  // 这里喂回 three 需要的 HTMLCanvasElement 形貌；S11 路线 B 的最小垫片（wx canvas 补
  // addEventListener/style）即在此处兼容，如与此冲突收敛于此单点。
  const renderer = new THREE.WebGLRenderer({ canvas: host.canvas as unknown as HTMLCanvasElement, antialias: true });
  const { width, height, dpr } = host.size;
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky.baseColor);
  scene.fog = new THREE.Fog(sky.baseColor, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(FOV_GROUND, width / height, 0.1, 160);
  camera.position.set(0, CAM_Y_BASE, CAM_Z);
  camera.lookAt(0, 0, LOOK_AHEAD_Z);
  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0c1020, 1.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(3, 8, 4);
  scene.add(keyLight);

  const track = createTrackVisuals(scene, laneWidth, { baseColor: sky.baseColor, flashColor: sky.flashColor, tint });
  const avatar = createAvatar(scene, laneWidth, sim.loadout);
  const coinField = createCoinField(scene, laneWidth);
  const obstacleLayer = createObstacleLayer(scene, laneWidth);
  const pickupLayer = createPickupLayer(scene, laneWidth);
  const cloudLayer = createCloudLayer(scene);
  const bursts = createBurstPool(scene);
  const speedLines = createSpeedLines(scene, tint);
  /** 胸口位置缓存：爆点与吸入动画对齐到身体，而不是脚底原点 */
  let chestX = 0, chestY = avatar.chestY;
  const fireAtPlayer = () => bursts.fireAt(chestX, chestY, BURST_Z);

  // ---------- 输入 → sim（v2：手势与键盘合并为单个 onInput 订阅，§7.8） ----------
  const offInput = adapter.onInput(e => {
    if (e.type === 'doubleTap') { sim.applyAction('skill'); return; } // 主动技能：双击屏幕（skills.json trigger=double_tap）
    if (e.type === 'swipe') {
      if (e.dir === 'left') sim.applyAction('laneL');
      else if (e.dir === 'right') sim.applyAction('laneR');
      else if (e.dir === 'up') sim.applyAction('jump');
      else if (e.dir === 'down') sim.applyAction('slide');
      return;
    }
    if (e.type !== 'key' || e.phase !== 'down') return; // v1 隐式仅 down（§7.8）；up 留给 UI 按压态
    const code = e.code;
    if (code === 'ArrowLeft') sim.applyAction('laneL');
    else if (code === 'ArrowRight') sim.applyAction('laneR');
    else if (code === 'ArrowUp' || code === 'Space') sim.applyAction('jump');
    else if (code === 'ArrowDown') sim.applyAction('slide');
    else if (code === 'KeyE' || code === 'ShiftLeft' || code === 'ShiftRight') sim.applyAction('skill');
  });

  // ---------- 窗口尺寸变化（v2 新增 D9）：重设绘制缓冲 + 相机宽高比，退订进 dispose ----------
  const offResize = adapter.canvas.onResize(size => {
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  });

  // ---------- 主循环：固定步长推进 + 插值渲染 ----------
  let raf = 0, last = adapter.now(), acc = 0, hudTimer = 0, shakeT = 0, endTimer = -1, ended = false, running = true;
  let camY = CAM_Y_BASE, lookY = 0, camX = 0; // 相机平滑状态（初值=稳态，避免首帧俯仰跳动）
  let paused = false; // 后台暂停位（见下方 onVisibility）

  // ---------- 后台可见性（§7.9）：进后台冻结 tick 累计，回前台把 last 对齐避免 dt 尖峰 ----------
  const offVisibility = adapter.onVisibility(hidden => {
    paused = hidden;
    if (!hidden) last = adapter.now();
  });

  function consumeEvents() {
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'coin') fireAtPlayer();
      else if (ev.type === 'helmetSave') { fireAtPlayer(); shakeT = 0.2; } // 头盔挡刀是关键时刻，给一次反馈
      else if (ev.type === 'hit') shakeT = 0.25;
      else if (ev.type === 'death') endTimer = 0;
      // 施放技能：爆点 + 轻微震屏，拖尾/光环等完整表现在 M4 T4.4
      else if (ev.type === 'cast') { fireAtPlayer(); shakeT = 0.12; }
      else if (ev.type === 'shieldBreak' || ev.type === 'boardBreak') { fireAtPlayer(); shakeT = 0.18; }
      // pickup：按用户要求不加特效与震动，仅 HUD 显示 buff 倒计时
    }
  }

  function renderSim(alpha: number) {
    const s = sim.state;
    // 插值距离：消除固定步长与渲染帧率不同步的跳动
    const dist = s.prevDistance + (s.distance - s.prevDistance) * alpha;

    avatar.update(s, fx);
    chestX = s.x; chestY = s.y + avatar.chestY;
    coinField.update({ coins: sim.coinsArr, t: s.t, dist, magnetOn: fx.magnetT > 0, playerX: chestX, playerY: chestY });
    obstacleLayer.update(sim.obstacles, dist, s.t);
    pickupLayer.update(sim.pickupsArr, dist, s.t);
    cloudLayer.update(sim.cloudsArr, dist, s.t, s.prevDistance, chestX, fx.flyT > 0 || s.gliding,
      (x, y, z) => bursts.fireAt(x, y, z, CLOUD_BURST_COLOR));
    track.update(dist);

    // 相机：水平跟随人物，垂直按地面/空中两套目标平滑随动，注视点放远到 -11m。
    // 地面目标：s.y*0.5 + 2.7 / lookY s.y*0.5（人物略靠后，跳跃时前方金币留在画面内）。
    // 空中目标（飞行或滑翔）：s.y*0.55 + 2.2 / lookY s.y*0.35 + 0.4，配合 FOV_AIR 保持开阔。
    shakeT = Math.max(0, shakeT - SHAKE_DECAY);
    const sk = shakeT > 0 ? (Math.random() - 0.5) * SHAKE_AMP : 0;
    const airborne = fx.flyT > 0 || s.gliding;
    const boost = Math.max(0, fx.speedMul - 1); // 雷霆冲刺等提速 buff 的表现强度
    speedLines.update(dist, boost);
    const tgtCamY = airborne ? s.y * CAM_AIR_Y_RATIO + CAM_AIR_Y_BASE : s.y * CAM_Y_RATIO + CAM_Y_BASE;
    const tgtLookY = airborne ? s.y * LOOK_AIR_Y_RATIO + LOOK_AIR_Y_BASE : s.y * CAM_Y_RATIO;
    camX += (s.x - camX) * CAM_FOLLOW;
    camY += (tgtCamY - camY) * CAM_FOLLOW;
    lookY += (tgtLookY - lookY) * CAM_FOLLOW;
    camera.position.x = camX + sk;
    camera.position.y = camY + sk;
    camera.position.z = CAM_Z;
    camera.lookAt(camX, lookY, LOOK_AHEAD_Z);
    const targetFov = (airborne ? FOV_AIR : FOV_GROUND) + Math.min(SPEED_FOV_MAX, boost * SPEED_FOV_PER_MUL); // 空中视野略广；加速再扩
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * FOV_LERP;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }

  function pushHud() {
    const s = sim.state;
    // buff 名称来自配置（items.json / skills.json 的 name），渲染层不硬编码文案
    const buffs = sim.buffList().map(b => ({ name: b.label, left: Math.ceil(b.left) }));
    // 滑翔提示不能写死 1s：按当前高度换算真实剩余（glideS≈1.8s），gliding 结束后自然不再 push
    if (s.gliding) buffs.push({ name: '滑翔降落', left: Math.max(0, s.y / glideFallMps) });
    const sk = sim.loadout.skill;
    cb.onHud({
      score: s.score, coins: s.coins, distance: s.distance, hits: s.hits, lives: sim.lives, buffs,
      skill: sk ? {
        label: sk.label,
        energy: sk.energyMax > 0 ? Math.min(1, s.energy / sk.energyMax) : 1,
        cd: s.skillCd,
        ready: sim.canCastSkill(),
      } : null,
    });
  }

  function tick(nowMs: number) {
    if (!running) return;
    if (paused) { last = nowMs; raf = adapter.requestFrame(tick); return; } // 后台冻结：不推进 sim，仅对齐时钟
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    acc += dt;
    while (acc >= STEP_DT) {
      sim.step();
      consumeEvents();
      acc -= STEP_DT;
    }
    bursts.update(dt, fx.magnetT > 0);
    renderSim(acc / STEP_DT);

    hudTimer += dt;
    if (hudTimer >= HUD_INTERVAL_S) { hudTimer = 0; pushHud(); }
    if (endTimer >= 0 && !ended) {
      endTimer += dt;
      if (endTimer > END_DELAY_S) { ended = true; cb.onEnd(sim.summary()); }
    }
    raf = adapter.requestFrame(tick);
  }
  raf = adapter.requestFrame(tick);

  if (cb.debug) installRunProbe(sim, () => ({ x: +camX.toFixed(2), y: +camY.toFixed(2) }), bursts,
    () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }));

  // 只销毁本局资源：不销毁主画布/GL 上下文（wx 屏幕画布不可重建，S10 D1 跨局复用）。
  function dispose() {
    running = false;
    adapter.cancelFrame(raf);
    offInput(); offResize(); offVisibility();
    if (cb.debug) uninstallRunProbe(); // ?debug 探针随场景销毁卸载，避免 __trRun 指向已销毁的 sim
    renderer.dispose();
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose());
    });
  }
  return { dispose };
}
