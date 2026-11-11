/**
 * 跑酷局渲染场景（render 层总装，docs/02 §5）
 * 本文件只做三件事：搭 Three.js 舞台、按固定步长推进 sim 并用插值 alpha 渲染、把事件翻成表现反馈。具体表现拆在同目录模块里：
 * trackVisuals（道路）/ avatarRig（角色）/ coinField（金币）/ entityLayers（障碍·道具箱·云）/ vfxBurst（爆点）/ runDebugProbe（?debug 自动化探针）/ runTheme（主题派生 deriveRunStage + 输入接线 wireRunInput）。
 * 铁律：只读 sim 状态，不反写玩法数据（单向数据流）。
 */
import * as THREE from 'three';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { GLCanvas, PlatformAdapter, WindowSize } from '@tr/framework/platform/platformAdapter.js';
import { createAvatar } from './avatarRig.js'; import { TR_GAME_CANVAS_ATTRIBUTES } from './glContext.js';
import { camTargets } from './cameraRig.js';
import { createCoinField } from './coinField.js';
import { createCloudLayer, createObstacleLayer } from './entityLayers.js';
import { createPickupLayer } from './pickupLayer.js';
import { createPickupModelLoader } from './pickupModels.js';
import { createIntroPanel } from './introPanel.js';
import { installRunProbe, uninstallRunProbe } from './runDebugProbe.js';
import { createSpeedLines } from './speedLines.js';
import { createTrackVisuals } from './trackVisuals.js';
import { createBurstPool } from './vfxBurst.js';
import { applyLightningFlash, createLightningFx, FLASH_LIGHT_GAIN } from './lightning.js';
import { deriveRunStage, wireRunInput } from './runTheme.js';
import { createPostFx } from './postfx.js';
import { createEnvMap, disposeEnvMap } from './stormspire/env.js';
import { createEruption } from './forgeheart/eruption.js';

export interface RunCallbacks {
  onHud(h: {
    score: number; coins: number; distance: number; hits: number; lives: number;
    buffs: { name: string; left: number }[];
    /** cd=冷却剩余秒；charge=下滑积攒门槛（{now, need}），无门槛技能为 null */
    skill: { label: string; cd: number; ready: boolean; charge: { now: number; need: number } | null } | null;
  }): void;
  onEnd(summary: ReturnType<RunnerSim['summary']>): void;
  /** 死亡瞬间回调（音频等表现层用；endTimer 计时与 onEnd 节奏不变） */
  onDeath?(): void;
  /** sim cast 事件（技能施放）回调：角色技能音效 */
  onCast?(): void;
  /** sim pickup 事件（道具箱，非金币）回调：角色拾取音效 */
  onPickup?(): void;
  /** 登场动画时点回调：start＝音频让位给登场音效，end＝交还并续播 BGM */
  onIntro?(stage: 'start' | 'end'): void;
  debug?: boolean;
}

/** 相机目标/FOV 在 cameraRig.ts 派生，本文件只保留平滑系数与注视点纵深（米）：四轮反馈「视角有点远」后由 -11 收到 -9.5（构图更紧、人物不上移出画） */
const CAM_FOLLOW = 0.25, FOV_LERP = 0.06, LOOK_AHEAD_Z = -9.5, FLIP_ROLL_S = 0.35; // FLIP_ROLL_S：B-7 反重力镜头滚转过渡时长，与 sim flip 事件节奏对齐（brief §11.2 B-6/B-7）
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
  // 主题派生（runner 参数 / 主题查找 / sky·fog·vfxTint·groundColor·lighting·scenery 推导）拆到 runTheme.ts
  const {
    laneWidth, glideFallMps, sky, fogColor, tint, groundColor, scenery,
    hemi, keyLight, HEMI_BASE, KEY_BASE, skyBase, fogBase, flashTint, flashGap,
    grade, wetRoad, env,
  } = deriveRunStage(content, opts);
  /** buff 派生视图：引擎原地更新同一个对象，渲染层缓存引用安全（docs/09 T2.2） */
  const fx = sim.fx;

  // ---------- 舞台 ---------- 全仓唯一 three 接线断言点（S10 §7.6 / D3）：GLCanvas 是结构化去 DOM 类型，这里喂回 three 需要的 HTMLCanvasElement 形貌；S11 路线 B 的最小垫片（wx canvas 补 addEventListener/ style）即在此处兼容，如与此冲突收敛于此单点。
  const renderer = new THREE.WebGLRenderer({ canvas: host.canvas as unknown as HTMLCanvasElement, ...TR_GAME_CANVAS_ATTRIBUTES });
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
  // 光（hemi/keyLight）与闪白插值色（skyBase/fogBase/flashTint）由 runTheme 按主题 lighting 派生；add 顺序不变
  scene.add(hemi);
  keyLight.position.set(3, 8, 4);
  scene.add(keyLight);
  const lightning = createLightningFx(scene);
  let ambientT = flashGap(); // 环境闪电间隔（theme.sky.flashEveryS 区间随机，缺省关闭）由 runTheme 派生
  // 主题 IBL：theme.env 声明了配色的主题挂程序化环境贴图（stormspire 雷暴/harbor 晚霞），null=无 IBL 自然降级
  const runEnv = env ? createEnvMap(renderer, env) : null;
  if (runEnv) scene.environment = runEnv;
  // 喷发管线（方案 B）：forgeheart 挂 eruption（LightningFx 同构，自排程 1s 预警+喷柱），flash 并入现有管线
  const eruption = scenery === 'forgeheart' ? createEruption(scene) : null;
  // 后处理全主题启用（bloom 阈值 0.82 下非自发光几乎无泛光；grade 由 theme.grade 覆盖）；wx/非 WebGL2 降级
  const postfx = createPostFx(renderer, scene, camera, adapter.env, grade);

  const track = createTrackVisuals(scene, laneWidth, {
    baseColor: sky.baseColor, flashColor: sky.flashColor, tint, groundColor,
    sky: { zenith: sky.baseColor, horizon: fogColor },
  }, scenery, { wetRoad }, { crossings: sim.crossings });
  const avatar = createAvatar(scene, laneWidth, sim.loadout, adapter);
  const coinField = createCoinField(scene, laneWidth, { envMap: runEnv, scenery });
  // scenery 来源与 createTrackVisuals 同款（themes.json 的 scenery 字段）：stormspire 时障碍层换雷脊废墟皮
  const obstacleLayer = createObstacleLayer(scene, laneWidth, scenery);
  // 道具 3D 模型（items.json model.prefab/spin）：磁铁有文件→近距换 3D；文件缺失→null 回贴图箱，捞取判定不受影响
  const pickupLayer = createPickupLayer(scene, laneWidth, createPickupModelLoader(content, adapter));
  const cloudLayer = createCloudLayer(scene);
  const bursts = createBurstPool(scene);
  const speedLines = createSpeedLines(scene, tint);
  /** 登场动画面板（characters.json intro 配了才有；无视频源＝只响音效不冻结） */
  const intro = createIntroPanel(scene, camera, sim.loadout.intro, sim.loadout.charId, s => cb.onIntro?.(s));
  /** 胸口位置缓存：爆点与吸入动画对齐到身体，而不是脚底原点 */
  let chestX = 0, chestY = avatar.chestY;
  const fireAtPlayer = (color?: number) => bursts.fireAt(chestX, chestY, BURST_Z, color);

  // ---------- 输入 → sim（v2）：swipe/key → applyAction 映射拆到 runTheme.ts（wireRunInput） ----------
  const offInput = wireRunInput(adapter, sim);

  // ---------- 窗口尺寸变化（v2 新增 D9）：重设绘制缓冲 + 相机宽高比，退订进 dispose ----------
  const offResize = adapter.canvas.onResize(size => {
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.width, size.height, false);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    postfx.resize(size.width, size.height, size.dpr); // composer 与 renderer 同口径（px=dpr×css）
  });

  // ---------- 主循环：固定步长推进 + 插值渲染 ----------
  let raf = 0, last = adapter.now(), acc = 0, hudTimer = 0, shakeT = 0, endTimer = -1, ended = false, running = true;
  let camY = rig0.camY, lookY = rig0.lookY, camX = 0; // 相机平滑状态（初值=稳态，避免首帧俯仰跳动）
  let rollK = 0, rollDir = 0; // B-7 镜头滚转渲染态：rollK∈[0,1]（0=正向 / 1=倒挂 π），flip 事件定方向，renderSim 按 dt/FLIP_ROLL_S 推进
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
      else if (ev.type === 'shieldBreak' || ev.type === 'boardBreak' || ev.type === 'slideGuard') { fireAtPlayer(); shakeT = 0.18; }
      else if (ev.type === 'zap') {
        fireAtPlayer(ZAP_BURST_COLOR); shakeT = 0.32;
        lightning.strike(ev.lane, ev.worldZ, laneWidth); // MC 式雷电：天→落点 + 全场闪白
        if (eruption) eruption.strike(ev.lane, ev.worldZ, laneWidth); // forgeheart：zap 继承喷柱+闪橙视觉
      } else if (ev.type === 'surge') { if (eruption) eruption.strike(ev.lane, ev.worldZ, laneWidth); } // M4 喷发判定化
        else if (ev.type === 'cross') { fireAtPlayer(0xffb454); shakeT = 0.1; } // M4 穿越判定：走位奖励爆点（泰坦亡火金色系）
      else if (ev.type === 'flip') rollDir = ev.flip === -1 ? 1 : -1; // B-7 反重力：进区镜头滚向 π、出区滚回 0（FLIP_ROLL_S 过渡，音效下潜另接）
      // pickup：按用户要求不加特效与震动，仅 HUD 显示 buff 倒计时（只回调音频）
      else if (ev.type === 'pickup') cb.onPickup?.();
    }
  }

  function renderSim(alpha: number, dt: number) {
    const s = sim.state;
    // 插值距离：消除固定步长与渲染帧率不同步的跳动
    const dist = s.prevDistance + (s.distance - s.prevDistance) * alpha;

    avatar.update(s, fx, dt);
    chestX = s.x; chestY = s.y + avatar.chestY; // B-7：chestY 已按滚转镜像（倒挂为负=挂点垂向脚底原点下方）
    coinField.update({ coins: sim.coinsArr, t: s.t, dist, magnetOn: fx.magnetT > 0, playerX: chestX, playerY: chestY });
    obstacleLayer.update(sim.obstacles, dist, s.t, s.flip, s.ceilH); // B-7：整层障碍（皮肤 emit + zap/step 默认盘）随 flip 镜像贴顶
    pickupLayer.update(sim.pickupsArr, dist, s.t);
    cloudLayer.update(sim.cloudsArr, dist, s.t, s.prevDistance, chestX, fx.flyT > 0 || s.gliding,
      (x, y, z) => bursts.fireAt(x, y, z, CLOUD_BURST_COLOR));
    track.update(dist, s.t);

    // 相机：水平跟随人物、垂直按地面/空中两套目标平滑随动（cameraRig 派生：地面 y*0.5+4.6/z 9.2，空中 y*0.75+5.3/z 11.4/FOV 68°）
    shakeT = Math.max(0, shakeT - SHAKE_DECAY);
    const sk = shakeT > 0 ? (Math.random() - 0.5) * SHAKE_AMP : 0;
    const airborne = fx.flyT > 0 || s.gliding;
    const boost = Math.max(0, fx.speedMul - 1); // 雷霆冲刺等提速 buff 的表现强度
    speedLines.update(dist, boost);
    postfx.update(dt, fx.speedMul); // 后处理冲刺联动：暗角收紧/饱和压低/bloom 微增（postfx 内部 lerp）
    // 雷电闪白：灯光增益 + 背景/雾色向冷白插值（MC 闪电式全场变亮，约 0.26s 回落）
    ambientT -= dt;
    if (ambientT <= 0) {
      ambientT = flashGap();
      lightning.strike(Math.round(Math.random() * 2 - 1), dist + 14 + Math.random() * 20, laneWidth);
    }
    const flash = Math.max(lightning.update(dt, dist), eruption ? eruption.update(dt, dist) : 0);
    hemi.intensity = HEMI_BASE + flash * FLASH_LIGHT_GAIN;
    keyLight.intensity = KEY_BASE + flash * FLASH_LIGHT_GAIN;
    const bg = scene.background as THREE.Color;
    applyLightningFlash(bg, (scene.fog as THREE.Fog).color, skyBase, fogBase, flashTint, flash);
    track.setFlash(flash, flashTint);
    // B-7 镜头滚转过渡：flip 事件置向，FLIP_ROLL_S 内 roll 0↔π（dt 累计、确定性；到端点停表，常态帧零开销）
    if (rollDir !== 0) { rollK += rollDir * dt / FLIP_ROLL_S; if (rollK <= 0 || rollK >= 1) { rollK = rollK <= 0 ? 0 : 1; rollDir = 0; } }
    const rig = camTargets(s.y, airborne, s.flip, s.ceilH); // B-7：flip=-1 时机位/注视点按天花板平面镜像（相机落下方仰视）
    camX += (s.x - camX) * CAM_FOLLOW;
    camY += (rig.camY - camY) * CAM_FOLLOW;
    lookY += (rig.lookY - lookY) * CAM_FOLLOW;
    camera.position.x = camX + sk;
    // 高速行驶的镜头微颠簸（用户点名）：仅地面态叠加，空中机位本身在升降、再叠会晕；
    // 幅度口径 0.03m≈半块挡风玻璃的呼吸感（23Hz 的 0.012m 是引擎细碎抖动），远小于最低障碍高度，不干扰预判。
    // 只加在 position.y 显示值上、不进 camY 平滑状态：颠簸是镜头噪声，不该被平滑器追赶也不该回摆。
    camera.position.y = camY + sk + (airborne ? 0 : Math.sin(s.t * 10) * 0.03 + Math.sin(s.t * 23) * 0.012);
    camera.position.z = rig.camZ;
    camera.lookAt(camX, lookY, LOOK_AHEAD_Z);
    if (rollK > 0) camera.rotateZ(rollK * Math.PI); // B-7：滚转绕视线轴叠加（lookAt 每帧先复位再叠，rollK=0 零开销跳过）
    const targetFov = rig.fov + Math.min(SPEED_FOV_MAX, boost * SPEED_FOV_PER_MUL); // 空中视野更广；加速再扩
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * FOV_LERP;
      camera.updateProjectionMatrix();
    }
    if (postfx.composer) postfx.composer.render(); // 后处理链尾 OutputPass 负责色彩空间收尾
    else renderer.render(scene, camera); // 降级路径（wx/非 WebGL2/构建失败）走裸渲染
  }

  function pushHud() {
    const s = sim.state;
    // buff 名称来自配置（items.json / skills.json 的 name），渲染层不硬编码文案
    const buffs = sim.buffList().map(b => ({ name: b.label, left: Math.ceil(b.left) }));
    // 滑翔提示不能写死 1s：按当前高度换算真实剩余（glideS≈1.8s），gliding 结束后自然不再 push
    if (s.gliding) buffs.push({ name: '滑翔降落', left: Math.max(0, s.y / glideFallMps) });
    if (s.surgeWarn > 0) buffs.push({ name: '喷发预警', left: Math.ceil(s.surgeWarn) }); // M4 喷发判定化：1s 红光预警进 HUD
    const sk = sim.loadout.skill;
    cb.onHud({
      score: s.score, coins: s.coins, distance: s.distance, hits: s.hits, lives: sim.lives, buffs,
      skill: sk ? {
        label: sk.label,
        cd: s.skillCd,
        ready: sim.canCastSkill(),
        charge: sk.chargeSlides > 0 ? { now: Math.min(s.slideCount, sk.chargeSlides), need: sk.chargeSlides } : null,
      } : null,
    });
  }

  function tick(nowMs: number) {
    if (!running) return;
    if (paused) { last = nowMs; raf = adapter.requestFrame(tick); return; } // 后台冻结：不推进 sim，仅对齐时钟
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    intro?.update(dt); // 无视频源时只计时恢复 BGM；active 仅表示需要冻结 sim 的视频面板
    if (intro?.active()) { renderer.render(scene, camera); raf = adapter.requestFrame(tick); return; } // 登场视频：整局冻结
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
    avatar.dispose(); // GLB 混流器停摆（几何体/材质由下面的 traverse 统一销毁）
    intro?.dispose(); // 只弃面板自身；视频元素与贴图归 apps 侧复用
    lightning.dispose();
    track.dispose();
    postfx.dispose(); // composer/逐 pass/双缓冲 target 全量释放（wx 降级态是 no-op）
    if (runEnv) disposeEnvMap(runEnv); eruption?.dispose();
    renderer.dispose();
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mat => mat.dispose());
    });
  }
  return { dispose };
}
