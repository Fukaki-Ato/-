/**
 * 赛道实体表现层：障碍池/云团池（对象池每帧零分配）——只把 sim 实体数组映射到预建 Mesh 槽位；皮肤走 SKIN_BY_SCENERY 表；整层挂根组随 B-7 反重力镜像（y'=ceilH−y）。
 */
import * as THREE from 'three';
import type { CloudEntity, ObstacleEntity } from '@tr/game/core/sim/trackGen.js';
import { RAMP_TOP_FLAT_M, obstacleX } from '@tr/game/core/sim/collision.js';
import { createPosterPicker, posterSize } from './adPosters.js';
import { createStormspireObstacleSkin, SKIN_CLASSES, type SkinCalibration } from './stormspire/obstacleSkin.js';
import { createTitanObstacleSkin } from './titan/obstacleSkin.js';
import { createForgeheartObstacleSkin } from './forgeheart/obstacleSkin.js';
import { createLibraryObstacleSkin } from './library/obstacleSkin.js';
import { applyWorldBend } from './stormspire/worldBend.js';

/** 障碍配色（docs/05 §2：敌对品红/警示黄，可交互蓝青） */
const OBS_COLOR: Record<string, number> = { low: 0xd9a24a, high: 0x7fd1ff, full: 0xff5fa2, vehicle: 0x4a6fd9, hazard: 0xb48cff, moving: 0xff5fa2, step: 0x9fd8ff };
const OBS_MAX = 40, CLOUD_MAX = 12;
/** 各层的前后可见深度（米）：超出即不占槽位 */
const OBS_NEAR = 10, OBS_FAR = -140, CLOUD_NEAR = 12, CLOUD_FAR = -140;
/** 高杆横杆下沿（与 core/sim 的 BAR_BOTTOM 对应：杆体画在 1.2m 以上，下方留钻的空间） */ const BAR_LOW_Y = 1.2;
/** 高杆横杆的可见透明度：半透明才不挡视线（审计 T3 蹲杆挡视线） */ const GATE_OPACITY = 0.4;
/** 横杆上海报的透明度：比杆体实一些才读得出画面，但仍能透出后面的金币（0.4 会让海报形同消失） */
const GATE_POSTER_OPACITY = 0.72;
/** low 障碍可视高度系数：与 core 判定口径对齐（collision.ts：s.y < o.h*0.75 判中），穿模观感消除 */
const LOW_VISUAL_H = 0.75;
/** hazard 薄片只是核心线，另叠 0.35m 高电弧光带，与「要跳 0.35m」的判定口径对齐 */
const HAZARD_BAND_H = 0.35;
/** 穿云判定：横向距离阈值与冲散动画时长（越宽越容易吃到穿云反馈；动画更快更明显） */
const CLOUD_HIT_X = 2.6, CLOUD_SCATTER_T = 0.45;
/** 软清除下沉动画：时长（秒）与下沉深度（米）——滑翔/着陆走廊清场不再整批瞬移消失 */
const SINK_T = 0.45, SINK_DROP_M = 1.6;
/** 闪电圈（obs_lightning_circle）配色：黑色圆盘 + 黄色闪电标志 */
const ZAP_DISC_COLOR = 0x0b0e16, ZAP_BOLT_COLOR = 0xffe14d;
/** 登车斜坡（obs_mount_step）配色：远处看得出的金属坡道 */
const RAMP_COLOR = 0x9fd8ff;
/** 海报面片浮在挡板正前方的间距（米）：贴 0 会和盒体正面 z-fighting */
const POSTER_FRONT = 0.012;

/** 皮肤工厂同构签名：与 stormspire/obstacleSkin.ts 的工厂逐字对齐（titan 皮同构实现） */
type SkinFactory = (scene: THREE.Scene, boxGeo: THREE.BufferGeometry, cal: SkinCalibration) => ReturnType<typeof createStormspireObstacleSkin> & { /** 该皮肤是否接管 zap（闪电圈）；未声明的皮肤 zap 走默认盘 */ zapSkin?: boolean };
/** 皮肤门控提表（titan-brief §10.0-2）：登记已实现皮肤的主题；zap/step 默认盘全主题一致；表外主题 skin 恒 null */
const SKIN_BY_SCENERY: Record<string, SkinFactory> = { stormspire: createStormspireObstacleSkin, titan: createTitanObstacleSkin, forgeheart: createForgeheartObstacleSkin, library: createLibraryObstacleSkin };

/** 单位斜坡几何（沿 +z 为坡底/玩家侧，-z 为坡顶/火车侧；y 0→1 线性升高；与 core/sim movement.supportHeight 的 step 截面同源，末端平顶另用盒体拼，见 update） */
function createRampGeometry(): THREE.BufferGeometry {
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], C = [0.5, 0, -0.5], D = [-0.5, 0, -0.5];
  const E = [-0.5, 1, -0.5], F = [0.5, 1, -0.5];
  const tris = [
    A, C, B, A, D, C,        // 底
    A, B, F, A, F, E,        // 坡面（法线朝上/朝玩家）
    D, F, C, D, E, F,        // 后端（接火车）
    A, E, D, B, C, F,        // 左右三角侧面
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

export function createObstacleLayer(scene: THREE.Scene, laneWidth: number, scenery = 'seaside') {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // 根组（B-7 反重力镜像载体）：整层障碍（默认盘槽位 + 皮肤实例）都挂它下面，flip=-1 时平移 ceilH 且 y 轴取反，组内全部局部 y 统一映射 ceilH−y；mirrorH=上帧镜像平面（0=未镜像），仅切换帧动变换与材质 side
  const root = new THREE.Group(); scene.add(root); let mirrorH = 0;
  // 障碍皮肤门控提表（titan-brief §10.0-2）：scenery → 皮肤工厂（同构签名，判定口径一致）；表外主题（seaside/coast/konbini/harbor/未登记 id）skin 恒为 null，update 逐行与旧版一致，stormspire 行为逐字节等价。
  const skinFrom = scene.children.length; // 工厂只 scene.add：记创建差集基线，随后把皮肤实例收养进根组（皮肤零感知）
  const skin = SKIN_BY_SCENERY[scenery]?.(scene, boxGeo, { obsMax: OBS_MAX, lowVisH: LOW_VISUAL_H, barLowY: BAR_LOW_Y }) ?? null;
  while (scene.children.length > skinFrom) root.add(scene.children[skinFrom]); // B-7：皮肤实例迁入镜像根组
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a93a8, roughness: 0.5, metalness: 0.3 });
  // 闪电圈专用几何：黑色圆盘（平放的圆柱薄片）与地面闪电标志（Shape 挤出的平面片）
  const zapDiscGeo = new THREE.CylinderGeometry(1.0, 1.05, 0.06, 22);
  const boltShape = new THREE.Shape();
  boltShape.moveTo(0.10, 0.62);
  boltShape.lineTo(-0.26, 0.02);
  boltShape.lineTo(-0.02, 0.02);
  boltShape.lineTo(-0.14, -0.62);
  boltShape.lineTo(0.30, 0.06);
  boltShape.lineTo(0.04, 0.06);
  boltShape.closePath();
  const boltGeo = new THREE.ShapeGeometry(boltShape);
  interface ObsUnit { bar: THREE.Mesh; posts: THREE.Mesh[]; band: THREE.Mesh; disc: THREE.Mesh; bolt: THREE.Mesh; ramp: THREE.Mesh; rampTop: THREE.Mesh; poster: THREE.Mesh }
  const rampGeo = createRampGeometry();
  const posterGeo = new THREE.PlaneGeometry(1, 1);
  const pickPoster = createPosterPicker(); // 一个障碍从头到尾一张图，不随 worldZ 漂移换图
  const rampMat = new THREE.MeshStandardMaterial({
    color: RAMP_COLOR, roughness: 0.35, metalness: 0.55, emissive: 0x1d4a63, emissiveIntensity: 0.6, side: THREE.DoubleSide,
  });
  const units: ObsUnit[] = [];
  for (let i = 0; i < OBS_MAX; i++) {
    const bar = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    bar.visible = false; root.add(bar);
    const posts: THREE.Mesh[] = [];
    for (let pi = 0; pi < 2; pi++) {
      const p = new THREE.Mesh(boxGeo, postMat); // 支撑柱：让「钻杆」可读性更强
      p.visible = false; root.add(p); posts.push(p);
    }
    // hazard 电弧光带：加色混合的半透明薄盒，提示实际跳跃高度（0.35m）
    const band = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
      color: 0xb48cff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    band.visible = false; root.add(band);
    // 黑盘减淡（2026-11-11 用户反馈「贴地影过重」）：0.96 近乎实心黑读成影子，降到 0.55 透出路面，闪电标志仍负责辨识
    const disc = new THREE.Mesh(zapDiscGeo, new THREE.MeshBasicMaterial({ color: ZAP_DISC_COLOR, transparent: true, opacity: 0.55 }));
    disc.visible = false; root.add(disc);
    const bolt = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({
      color: ZAP_BOLT_COLOR, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    bolt.rotation.x = -Math.PI / 2; bolt.scale.setScalar(0.85);
    bolt.visible = false; root.add(bolt);
    // 登车斜坡 = 坡面楔体 + 坡顶平台两段（与 movement 的 step 截面同源）
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.visible = false; root.add(ramp);
    const rampTop = new THREE.Mesh(boxGeo, rampMat);
    rampTop.visible = false; root.add(rampTop);
    // 广告墙正面：不受光的海报面片（广告牌自带亮度，夜色里不该被方向光压暗）。transparent 一次性打开、只改 opacity：
    // 横杆要半透明而矮障要不透明，逐帧翻 transparent 会重排渲染队列。
    const poster = new THREE.Mesh(posterGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    poster.visible = false; root.add(poster);
    units.push({ bar, posts, band, disc, bolt, ramp, rampTop, poster });
  }

  // 雷脊假弯道：默认盘残件（zap 圆盘/闪电标志/step 斜坡/海报/电弧光带/横杆立柱）与雷脊皮肤一样跟着地面弯，
  // 否则远处未换皮障碍漂出弯道（皮肤件在 obstacleSkin.ts 内注入；applyWorldBend 幂等，见 stormspire/worldBend.ts）
  if (['stormspire', 'titan', 'forgeheart', 'library'].includes(scenery)) {
    applyWorldBend(postMat);
    applyWorldBend(rampMat);
    for (const u of units) {
      applyWorldBend(u.bar.material as THREE.Material);
      applyWorldBend(u.band.material as THREE.Material);
      applyWorldBend(u.disc.material as THREE.Material);
      applyWorldBend(u.bolt.material as THREE.Material);
      applyWorldBend(u.poster.material as THREE.Material);
    }
  }

  // B-7 材质 side 快照（建层后一次）：镜像把根组 scale.y 取反、三角面绕向随之颠倒——FrontSide 材质会只画远端内壁（透视穿帮）；进镜像临时切 DoubleSide，退出按快照精确还原（bolt/rampMat 本就双面）
  const sideSnap: Array<[THREE.Material, THREE.Side]> = [];
  for (const c of root.children) { const m = (c as THREE.Mesh).material as THREE.Material; sideSnap.push([m, m.side]); }

  const hideUnit = (u: ObsUnit) => {
    u.bar.visible = false;
    u.band.visible = false;
    u.disc.visible = false;
    u.bolt.visible = false;
    u.ramp.visible = false;
    u.rampTop.visible = false;
    u.poster.visible = false;
    for (const p of u.posts) p.visible = false;
  };

  return {
    update(list: ObstacleEntity[], dist: number, t: number, flip: 1 | -1 = 1, ceilH = 0) {
      // B-7 反重力镜像：flip=-1 时根组 y=ceilH、scale.y=-1，皮肤 emit 与 zap/step 默认盘的全部局部 y 统一映射 ceilH−y（obstacleSkin 零感知）；仅切换帧写变换与 side，常态每帧只多一次比较，flip=1 逐字节同轨
      const mh = flip === -1 ? ceilH : 0;
      if (mh !== mirrorH) { mirrorH = mh; root.position.y = mh; root.scale.y = mh === 0 ? 1 : -1; for (const [mat, sd] of sideSnap) mat.side = mh === 0 ? sd : THREE.DoubleSide; }
      if (skin) skin.beginFrame(); // 皮肤实例每帧按当前可见障碍全量重写（count 归零即整池不可见）
      let i = 0;
      for (const o of list) {
        if (i >= OBS_MAX) break;
        const z = dist - o.worldZ;
        if (z < OBS_FAR || z > OBS_NEAR) continue;
        const u = units[i++];
        // 软清除（滑翔/着陆走廊）播下沉消散：不再一帧整批消失（用户反馈「场景会刷新一次」）
        const sink = o.clearT != null ? Math.min((t - o.clearT) / SINK_T, 1) : 0;
        if (sink >= 1) { hideUnit(u); continue; }
        const sinkY = sink * SINK_DROP_M;
        const isZap = o.zap === true;
        // moving（摆锤/挡板）横摆位置与 core 判定同源（obstacleX：含「不得扫出路面」限幅与脏数据防呆）
        const ox = o.cls === 'moving' ? obstacleX(o, t, laneWidth) : o.lane * laneWidth;
        // 皮肤：六类换皮。zap 走默认盘，但声明 zapSkin 的皮肤（forgeheart 灼痕盘）也接；未声明者（stormspire/titan）逐字节不变
        const skinned = skin !== null && o.cls !== 'step' && SKIN_CLASSES.has(o.cls)
          && (!isZap || skin.zapSkin === true);
        /** 正面海报（广告墙竖版图 / 矮障·横杆·车头的方版图）；不挂或宿主未注入时为 null ⇒ 纯色挡板 */
        const slot = pickPoster(o);
        const m = u.bar;
        m.visible = !isZap && o.cls !== 'step' && !skinned; // 闪电圈用圆盘+闪电标志、斜坡用坡道几何，不画通用方块
        let sx = o.w, sy = o.h, sz = o.d, py = o.h / 2;
        if (m.visible) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.color.setHex(slot ? slot.frame : OBS_COLOR[o.cls] ?? 0xd9a24a);
          mat.emissive.setHex(o.cls === 'hazard' ? 0x7a3fd9 : 0x000000);
          mat.roughness = 0.6;
          // 高杆横杆（obs_gate_low）半透明化：下方的金币与障碍要能透出来，只留立柱提示轮廓
          mat.transparent = o.cls === 'high';
          mat.opacity = (o.cls === 'high' ? GATE_OPACITY : 1) * (1 - sink);
          mat.depthWrite = o.cls !== 'high';
          if (o.cls === 'high') { sy = Math.max(0.5, o.h - BAR_LOW_Y); py = BAR_LOW_Y + sy / 2; } // 顶部横杆，下方可钻
          // low：可视高度按判定口径画到 h*0.75（碰撞盒仍为 o.h，见 core/sim collision.ts）
          if (o.cls === 'low') { sy = o.h * LOW_VISUAL_H; py = sy / 2; }
          if (o.cls === 'hazard') { sy = 0.06; py = 0.03; }
          if (o.cls === 'moving') { sx = sy = sz = 1.1; py = 0.55; } // 挡板贴地滑动：跳起越过（判定 s.y < h*0.75）
          m.scale.set(sx, sy, sz);
          m.position.set(ox, py - sinkY, z);
        }
        const ps = u.poster;
        ps.visible = slot !== null && m.visible; // 换皮障碍 bar 不可见 ⇒ 海报自动不画（废墟不贴二次元海报）
        if (ps.visible && slot !== null) { // 海报内接「可见盒体」并与其同心：横杆在 1.2m 以上，不能按贴地算
          const img = slot.tex.image as { width?: number; height?: number } | undefined;
          const fit = posterSize(sx, sy, img?.width ?? 0, img?.height ?? 0);
          const op = o.cls === 'high' ? GATE_POSTER_OPACITY : 1;
          ps.scale.set(fit.w, fit.h, 1);
          ps.position.set(ox, py - sinkY, z + o.d / 2 + POSTER_FRONT);
          const pmat = ps.material as THREE.MeshBasicMaterial;
          if (pmat.map !== slot.tex) { pmat.map = slot.tex; pmat.needsUpdate = true; } // 换图要 bump 版本，否则 map uniform 不刷新
          pmat.opacity = op * (1 - sink);
        }
        const band = u.band;
        band.visible = o.cls === 'hazard' && !isZap; // 普通电弧地面的可跳高度提示；zap 有专属电光
        if (band.visible) { // 电弧光带：0.35m 高，缓慢闪烁提示可跳高度
          band.scale.set(o.w, HAZARD_BAND_H, o.d);
          band.position.set(ox, HAZARD_BAND_H / 2 - sinkY, z);
          (band.material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.12 * Math.sin(t * 8 + ox * 1.7)) * (1 - sink);
        }
        // 登车斜坡：坡面 + 末端平顶两段，位置与 movement 的 step 截面同源。坡面覆盖偏移 w∈[-d/2, d/2-flat]（入口贴地→出口满高），
        // 渲染上低端在近玩家侧、高端在火车侧；平顶覆盖 w∈[d/2-flat, d/2]（火车侧），必须画在 -z 端——写反会变成一堵竖在入口的 2.4m 高挡板（用户反馈「上火车这块的挡板」的根因）。
        const isStep = o.cls === 'step';
        u.ramp.visible = isStep;
        u.rampTop.visible = isStep;
        if (isStep) {
          const slopeLen = Math.max(0.1, o.d - RAMP_TOP_FLAT_M);
          u.ramp.scale.set(o.w, o.h, slopeLen);
          u.ramp.position.set(ox, -sinkY, z + o.d / 2 - slopeLen / 2);
          u.rampTop.scale.set(o.w, o.h, RAMP_TOP_FLAT_M);
          u.rampTop.position.set(ox, o.h / 2 - sinkY, z - o.d / 2 + RAMP_TOP_FLAT_M / 2);
          rampMat.opacity = 1 - sink;
          rampMat.transparent = sink > 0;
        }
        // 闪电圈：黑色圆盘 + 黄色闪电标志（加色混合、按帧闪烁）；已上皮（forgeheart 灼痕盘）时让位
        u.disc.visible = isZap && !skinned;
        u.bolt.visible = isZap && !skinned;
        if (isZap) {
          u.disc.position.set(ox, 0.05 - sinkY, z);
          (u.disc.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - sink);
          u.bolt.position.set(ox, 0.08 - sinkY, z);
          const flick = 0.5 + 0.5 * Math.sin(t * 12 + o.worldZ * 2.7);
          (u.bolt.material as THREE.MeshBasicMaterial).opacity = (0.45 + 0.5 * flick) * (1 - sink);
        }
        for (let pi = 0; pi < 2; pi++) { // 高杆支撑柱：立在横杆两端，从地面顶到杆顶
          const post = u.posts[pi];
          post.visible = o.cls === 'high' && !skinned; // 雷脊换皮：金属立柱换成石柱+柱头（obstacleSkin）
          if (post.visible) {
            post.scale.set(0.14, o.h, 0.14);
            post.position.set(ox + (pi === 0 ? -1 : 1) * (o.w / 2 - 0.07), o.h / 2 - sinkY, z);
          }
        }
        if (skin !== null && skinned) skin.emit(o, ox, z, sinkY); // 雷脊：写本障碍的皮肤实例（判定位姿复用）
      }
      for (; i < OBS_MAX; i++) hideUnit(units[i]);
      if (skin) skin.endFrame(); // 收尾：按写满的实例数定 count 与可见性（≤7 条新增 draw call）
    },
  };
}

/** 云团层：三球低多边形云；被角色穿过时回调 onPass 触发爆点，并播放约 0.45 秒冲散淡出 */
export function createCloudLayer(scene: THREE.Scene) {
  const mat0 = new THREE.MeshStandardMaterial({ color: 0xe8eef8, roughness: 1, transparent: true, opacity: 0.92 });
  interface CloudUnit { g: THREE.Group; mats: THREE.MeshStandardMaterial[] }
  const units: CloudUnit[] = [];
  for (let i = 0; i < CLOUD_MAX; i++) {
    const g = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    for (const [ox, oy, s] of [[0, 0, 1], [0.62, -0.1, 0.72], [-0.6, -0.12, 0.66]] as const) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), mat0.clone());
      m.position.set(ox, oy, 0); m.scale.setScalar(s);
      g.add(m); mats.push(m.material as THREE.MeshStandardMaterial);
    }
    g.visible = false; scene.add(g);
    units.push({ g, mats });
  }
  const scattered = new Map<number, number>(); // cloudWorldZ → 冲散开始时间

  return {
    update(list: CloudEntity[], dist: number, t: number, prevDistance: number, playerX: number, airborne: boolean, onPass: (x: number, y: number, z: number) => void) {
      let i = 0;
      for (const cl of list) {
        const z = dist - cl.worldZ;
        const sc = scattered.get(cl.worldZ);
        // 穿云判定：角色面掠过云心且横向接近、且处于飞行/滑翔高度
        if (sc === undefined && airborne && prevDistance < cl.worldZ && dist >= cl.worldZ && Math.abs(cl.x - playerX) < CLOUD_HIT_X) {
          scattered.set(cl.worldZ, t);
          onPass(cl.x, cl.y, z);
        }
        if (i >= CLOUD_MAX) continue;
        if (z < CLOUD_FAR || z > CLOUD_NEAR) continue;
        const u = units[i++];
        u.g.visible = true;
        u.g.position.set(cl.x, cl.y, z);
        if (sc !== undefined) {
          const k = Math.min((t - sc) / CLOUD_SCATTER_T, 1);
          u.g.scale.setScalar(1 + k * 2.4);                 // 更明显地炸开
          for (const m of u.mats) m.opacity = 0.92 * (1 - k) * (1 - k); // 二次曲线淡出，前段更快
        } else {
          u.g.scale.setScalar(1);
          for (const m of u.mats) m.opacity = 0.92;
        }
      }
      for (; i < CLOUD_MAX; i++) units[i].g.visible = false;
      // 云已回收（身后超过近视野）即清理冲散记录，避免 scattered 只增不减（审计 T4）
      for (const wz of scattered.keys()) if (dist - wz > CLOUD_NEAR) scattered.delete(wz);
    },
  };
}
