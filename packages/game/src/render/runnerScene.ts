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
import { camTargets } from './cameraRig.js';
import { createCoinField } from './coinField.js';
import { createCloudLayer, createObstacleLayer, createPickupLayer } from './entityLayers.js';
import { installRunProbe, uninstallRunProbe } from './runDebugProbe.js';
import { createSpeedLines } from './speedLines.js';
import { createTrackVisuals } from './trackVisuals.js';
import { createBurstPool } from './vfxBurst.js';
import { applyLightningFlash, createLightningFx, FLASH_LIGHT_GAIN, FLASH_TINT } from './lightning.js';

export interface RunCallbacks {
  onHud(h: {
    score: number; coins: number; distance: number; hits: number; lives: number;
    buffs: { name: string; left: number }[];
    skill: { label: string; energy: number; cd: number; ready: boolean } | null;
  }): void;
  onEnd(summary: ReturnType<RunnerSim['summary']>): void;
  /** 死亡瞬间回调（音频等表现层用；endTimer 计时与 onEnd 节奏不变） */
  onDeath?(): void;
  /** sim cast 事件（技能施放）回调：角色技能音效 */
  onCast?(): void;
  /** sim pickup 事件（道具箱，非金币）回调：角色拾取音效 */
  onPickup?(): void;
  debug?: boolean;
}

/** 相机参数（docs/02 §8：跟随人物但不 1:1 抬高，否则近处地面会翻出画面下沿）。
 *  机位/注视点/FOV 目标统一由 cameraRig.ts 纯函数派生（地面/空中两套，可回归测试），
 *  这里只保留平滑系数与注视点纵深；审计 T1/T2 的历史口径见 cameraRig.ts 注释。 */
/** 注视点纵深（米）：四轮反馈「视角有点远」后由 -11 收到 -9.5（构图更紧、人物不上移出画） */
const CAM_FOLLOW = 0.25, FOV_LERP = 0.06, LOOK_AHEAD_Z = -9.5;
/** 加速（speedMul>1）的视野扩张：按 (speedMul-1) 线性加宽并封顶（雷霆冲刺一类技能要看得见加速） */
const SPEED_FOV_PER_MUL = 70, SPEED_FOV_MAX = 10;
/** 震屏：每帧衰减量与随机幅度 */
const SHAKE_DECAY = 1 / 60, SHAKE_AMP = 0.24;
/** 死亡后停留多久进结算页、HUD 刷新间隔（秒） */
const END_DELAY_S = 1.2, HUD_INTERVAL_S = 0.15;
/** 爆点的画面深度（角色身体前方 0.62m，胸口高度由 chestY 提供）；穿云用白色 */
const BURST_Z = -0.62, CLOUD_BURST_COLOR = 0xdfe9f5;
/** 闪电圈触电爆点用黄色 */
const ZAP_BURST_COLOR = 0xffe14d;
/** 雾视距：障碍在约 3 秒外可见（地铁酷跑式远望） */
const FOG_NEAR = 22, FOG_FAR = 120;

export function createRunnerScene(
  host: { canvas: GLCanvas; size: WindowSize },
  adapter: PlatformAdapter, sim: RunnerSim, content: GameContent, cb: RunCallbacks,
  opts?: { themeId?: string },
) {
  const runner = (content.game.params.runner ?? {}) as Record<string, number>;
  const laneWidth = runner.laneWidth ?? 2.2;
  /** 滑翔倒计时换算：core 以 heightM/glideS 匀速下降（movement.ts），HUD 显示与 s.gliding 一致的真实剩余秒数 */
  const flight = (content.game.params.flight ?? {}) as Record<string, number>;
  const glideFallMps = (flight.heightM ?? 4.6) / (flight.glideS ?? 1.8);
  // 默认主题 = 大厅「场景切换」所选（storage 经 mainFlow 注入）；缺省回首个 live 条目（不硬编码 id，避免删主题时漏改）
  const themeItems = (content.themes.items ?? []) as Record<string, unknown>[];
  const theme = (opts?.themeId ? themeItems.find(t => t['id'] === opts.themeId) : undefined)
    ?? themeItems.find(t => t['status'] === 'live') ?? themeItems[0];
  const sky = (theme?.sky ?? { baseColor: '#8ED0F2', flashColor: '#FFF3C4' }) as { baseColor: string; flashColor: string };
  const fogColor = ((theme?.fog as Record<string, unknown> | undefined)?.color as string | undefined) ?? sky.baseColor;
  const tint = (theme?.vfxTint as string | undefined) ?? '#FFD98A';
  const groundColor = (theme?.groundColor as string | undefined) ?? '#E3CFA4';
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
  scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);
  const rig0 = camTargets(0, false);
  const camera = new THREE.PerspectiveCamera(rig0.fov, width / height, 0.1, 160);
  camera.position.set(0, rig0.camY, rig0.camZ);
  camera.lookAt(0, rig0.lookY, LOOK_AHEAD_Z);
  // 白天海滨的光：半球光天空浅蓝/地面暖沙，主光偏暖阳色（夜景那套冷光会让晴天发灰）
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0xd8c39a, 1.15);
  const HEMI_BASE = 1.15;
  const keyLight = new THREE.DirectionalLight(0xfff2d0, 1.9);
  const KEY_BASE = 1.9;
  scene.add(hemi);
  keyLight.position.set(3, 8, 4);
  scene.add(keyLight);
  /** 闪白（雷电）：背景/雾色的基色与目标色缓存，逐帧按闪白强度插值 */
  const skyBase = new THREE.Color(sky.baseColor), fogBase = new THREE.Color(fogColor), flashTint = new THREE.Color(FLASH_TINT);
  const lightning = createLightningFx(scene);

  const track = createTrackVisuals(scene, laneWidth, {
    baseColor: sky.baseColor, flashColor: sky.flashColor, tint, groundColor,
    sky: { zenith: sky.baseColor, horizon: fogColor },
  });
  const avatar = createAvatar(scene, laneWidth, sim.loadout);
  const coinField = createCoinField(scene, laneWidth);
  const obstacleLayer = createObstacleLayer(scene, laneWidth);
  const pickupLayer = createPickupLayer(scene, laneWidth);
  const cloudLayer = createCloudLayer(scene);
  const bursts = createBurstPool(scene);
  const speedLines = createSpeedLines(scene, tint);
  /** 胸口位置缓存：爆点与吸入动画对齐到身体，而不是脚底原点 */
  let chestX = 0, chestY = avatar.chestY;
  const fireAtPlayer = (color?: number) => bursts.fireAt(chestX, chestY, BURST_Z, color);

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
  let camY = rig0.camY, lookY = rig0.lookY, camX = 0; // 相机平滑状态（初值=稳态，避免首帧俯仰跳动）
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
      else if (ev.type === 'death') {
        endTimer = 0;
        cb.onDeath?.();
        // 闪电圈致死：雷电落到致死点（普通致死无位置字段，不触发）
        if (ev.lane !== undefined && ev.worldZ !== undefined) lightning.strike(ev.lane, ev.worldZ, laneWidth);
      }
      // 施放技能：爆点 + 轻微震屏，拖尾/光环等完整表现在 M4 T4.4
      else if (ev.type === 'cast') { fireAtPlayer(); shakeT = 0.12; cb.onCast?.(); }
      else if (ev.type === 'shieldBreak' || ev.type === 'boardBreak') { fireAtPlayer(); shakeT = 0.18; }
      else if (ev.type === 'zap') {
        fireAtPlayer(ZAP_BURST_COLOR); shakeT = 0.32;
        lightning.strike(ev.lane, ev.worldZ, laneWidth); // MC 式雷电：天→落点 + 全场闪白
      }
      // pickup：按用户要求不加特效与震动，仅 HUD 显示 buff 倒计时（只回调音频）
      else if (ev.type === 'pickup') cb.onPickup?.();
    }
  }

  function renderSim(alpha: number, dt: number) {
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

    // 相机：水平跟随人物，垂直按地面/空中两套目标平滑随动，注视点前探 9.5m。
    // 目标全部由 cameraRig 派生：地面 s.y*0.5+4.6、camZ 9.2（俯角 12.8°，四轮「高度够了但远」收距后的口径）；
    // 空中（飞行/滑翔）机位抬到 s.y*0.75+5.3、后拉 z=11.4、注视点压回 s.y*0.28+0.8、
    // FOV 68°——同帧装下地面障碍、角色与空中金币带，且与地面机位差 1.85m/2.2m/13° 肉眼可辨。
    shakeT = Math.max(0, shakeT - SHAKE_DECAY);
    const sk = shakeT > 0 ? (Math.random() - 0.5) * SHAKE_AMP : 0;
    const airborne = fx.flyT > 0 || s.gliding;
    const boost = Math.max(0, fx.speedMul - 1); // 雷霆冲刺等提速 buff 的表现强度
    speedLines.update(dist, boost);
    // 雷电闪白：灯光增益 + 背景/雾色向冷白插值（MC 闪电式全场变亮，约 0.26s 回落）
    const flash = lightning.update(dt, dist);
    hemi.intensity = HEMI_BASE + flash * FLASH_LIGHT_GAIN;
    keyLight.intensity = KEY_BASE + flash * FLASH_LIGHT_GAIN;
    const bg = scene.background as THREE.Color;
    applyLightningFlash(bg, (scene.fog as THREE.Fog).color, skyBase, fogBase, flashTint, flash);
    track.setFlash(flash, flashTint);
    const rig = camTargets(s.y, airborne);
    camX += (s.x - camX) * CAM_FOLLOW;
    camY += (rig.camY - camY) * CAM_FOLLOW;
    lookY += (rig.lookY - lookY) * CAM_FOLLOW;
    camera.position.x = camX + sk;
    camera.position.y = camY + sk;
    camera.position.z = rig.camZ;
    camera.lookAt(camX, lookY, LOOK_AHEAD_Z);
    const targetFov = rig.fov + Math.min(SPEED_FOV_MAX, boost * SPEED_FOV_PER_MUL); // 空中视野更广；加速再扩
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
    renderSim(acc / STEP_DT, dt);

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
    () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }), coinField);

  // 只销毁本局资源：不销毁主画布/GL 上下文（wx 屏幕画布不可重建，S10 D1 跨局复用）。
  function dispose() {
    running = false;
    adapter.cancelFrame(raf);
    offInput(); offResize(); offVisibility();
    if (cb.debug) uninstallRunProbe(); // ?debug 探针随场景销毁卸载，避免 __trRun 指向已销毁的 sim
    lightning.dispose();
    renderer.dispose();
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose());
    });
  }
  return { dispose };
}
