/**
 * 赛道实体表现层：障碍池 / 道具箱池 / 云团池（docs/02 §8 对象池，每帧零分配）
 * 只把 sim 的实体数组映射到预建的 Mesh 槽位上，不做任何玩法判定。
 */
import * as THREE from 'three';
import type { CloudEntity, ObstacleEntity, PickupEntity } from '@tr/game/core/sim/trackGen.js';
import { obstacleX } from '@tr/game/core/sim/collision.js';

/** 障碍配色（docs/05 §2：敌对品红/警示黄，可交互蓝青） */
const OBS_COLOR: Record<string, number> = { low: 0xd9a24a, high: 0x7fd1ff, full: 0xff5fa2, vehicle: 0x4a6fd9, hazard: 0xb48cff, moving: 0xff5fa2, step: 0x9fd8ff };
/** 道具箱配色（未列出的道具用白色；正式贴图见 docs/05 §6） */
const PICKUP_COLOR: Record<string, number> = { item_magnet: 0xb48cff, item_boots: 0x43d9a3 };
const OBS_MAX = 40, PICKUP_MAX = 8, CLOUD_MAX = 12;
/** 各层的前后可见深度（米）：超出即不占槽位 */
const OBS_NEAR = 10, OBS_FAR = -140, PICKUP_NEAR = 8, PICKUP_FAR = -320, CLOUD_NEAR = 12, CLOUD_FAR = -140;
/** 高杆横杆下沿（与 core/sim 的 BAR_BOTTOM 对应：杆体画在 1.2m 以上，下方留钻的空间） */
const BAR_LOW_Y = 1.2;
/** 高杆横杆的可见透明度：半透明才不挡视线（审计 T3 蹲杆挡视线） */
const GATE_OPACITY = 0.4;
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

export function createObstacleLayer(scene: THREE.Scene, laneWidth: number) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
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
  interface ObsUnit { bar: THREE.Mesh; posts: THREE.Mesh[]; band: THREE.Mesh; disc: THREE.Mesh; bolt: THREE.Mesh }
  const units: ObsUnit[] = [];
  for (let i = 0; i < OBS_MAX; i++) {
    const bar = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    bar.visible = false; scene.add(bar);
    const posts: THREE.Mesh[] = [];
    for (let pi = 0; pi < 2; pi++) {
      const p = new THREE.Mesh(boxGeo, postMat); // 支撑柱：让「钻杆」可读性更强
      p.visible = false; scene.add(p); posts.push(p);
    }
    // hazard 电弧光带：加色混合的半透明薄盒，提示实际跳跃高度（0.35m）
    const band = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
      color: 0xb48cff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    band.visible = false; scene.add(band);
    const disc = new THREE.Mesh(zapDiscGeo, new THREE.MeshBasicMaterial({ color: ZAP_DISC_COLOR, transparent: true, opacity: 0.96 }));
    disc.visible = false; scene.add(disc);
    const bolt = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({
      color: ZAP_BOLT_COLOR, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    bolt.rotation.x = -Math.PI / 2; bolt.scale.setScalar(0.85);
    bolt.visible = false; scene.add(bolt);
    units.push({ bar, posts, band, disc, bolt });
  }

  const hideUnit = (u: ObsUnit) => {
    u.bar.visible = false;
    u.band.visible = false;
    u.disc.visible = false;
    u.bolt.visible = false;
    for (const p of u.posts) p.visible = false;
  };

  return {
    update(list: ObstacleEntity[], dist: number, t: number) {
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
        const m = u.bar;
        m.visible = !isZap; // 闪电圈用圆盘+闪电标志表现，不画通用方块
        if (m.visible) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.color.setHex(OBS_COLOR[o.cls] ?? 0xd9a24a);
          mat.emissive.setHex(o.cls === 'hazard' ? 0x7a3fd9 : 0x000000);
          mat.roughness = 0.6;
          // 高杆横杆（obs_gate_low）半透明化：下方的金币与障碍要能透出来，只留立柱提示轮廓
          mat.transparent = o.cls === 'high';
          mat.opacity = (o.cls === 'high' ? GATE_OPACITY : 1) * (1 - sink);
          mat.depthWrite = o.cls !== 'high';
          let sx = o.w, sy = o.h, sz = o.d, py = o.h / 2;
          if (o.cls === 'high') { sy = Math.max(0.5, o.h - BAR_LOW_Y); py = BAR_LOW_Y + sy / 2; } // 顶部横杆，下方可钻
          // low：可视高度按判定口径画到 h*0.75（碰撞盒仍为 o.h，见 core/sim collision.ts）
          if (o.cls === 'low') { sy = o.h * LOW_VISUAL_H; py = sy / 2; }
          if (o.cls === 'hazard') { sy = 0.06; py = 0.03; }
          if (o.cls === 'moving') { sx = sy = sz = 1.1; py = 0.55; } // 挡板贴地滑动：跳起越过（判定 s.y < h*0.75）
          m.scale.set(sx, sy, sz);
          m.position.set(ox, py - sinkY, z);
        }
        const band = u.band;
        band.visible = o.cls === 'hazard' && !isZap; // 普通电弧地面的可跳高度提示；zap 有专属电光
        if (band.visible) { // 电弧光带：0.35m 高，缓慢闪烁提示可跳高度
          band.scale.set(o.w, HAZARD_BAND_H, o.d);
          band.position.set(ox, HAZARD_BAND_H / 2 - sinkY, z);
          (band.material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.12 * Math.sin(t * 8 + ox * 1.7)) * (1 - sink);
        }
        // 闪电圈：黑色圆盘 + 黄色闪电标志（加色混合、按帧闪烁）
        u.disc.visible = isZap;
        u.bolt.visible = isZap;
        if (isZap) {
          u.disc.position.set(ox, 0.05 - sinkY, z);
          (u.disc.material as THREE.MeshBasicMaterial).opacity = 0.96 * (1 - sink);
          u.bolt.position.set(ox, 0.08 - sinkY, z);
          const flick = 0.5 + 0.5 * Math.sin(t * 12 + o.worldZ * 2.7);
          (u.bolt.material as THREE.MeshBasicMaterial).opacity = (0.45 + 0.5 * flick) * (1 - sink);
        }
        for (let pi = 0; pi < 2; pi++) { // 高杆支撑柱：立在横杆两端，从地面顶到杆顶
          const post = u.posts[pi];
          post.visible = o.cls === 'high';
          if (post.visible) {
            post.scale.set(0.14, o.h, 0.14);
            post.position.set(ox + (pi === 0 ? -1 : 1) * (o.w / 2 - 0.07), o.h / 2 - sinkY, z);
          }
        }
      }
      for (; i < OBS_MAX; i++) hideUnit(units[i]);
    },
  };
}

export function createPickupLayer(scene: THREE.Scene, laneWidth: number) {
  const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < PICKUP_MAX; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, emissiveIntensity: 0.5 }));
    m.visible = false; scene.add(m); meshes.push(m);
  }

  return {
    update(list: PickupEntity[], dist: number, t: number) {
      let i = 0;
      for (const p of list) {
        if (p.taken || i >= PICKUP_MAX) continue;
        const z = dist - p.worldZ;
        if (z < PICKUP_FAR || z > PICKUP_NEAR) continue;
        const m = meshes[i++];
        m.visible = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        const col = PICKUP_COLOR[p.itemRef] ?? 0xffffff;
        mat.color.setHex(col);
        mat.emissive.setHex(col);
        mat.emissiveIntensity = 0.55;
        m.position.set(p.lane * laneWidth, 0.78 + Math.sin(t * 2 + p.worldZ) * 0.09, z);
        m.rotation.y = t * 1.8;
      }
      for (; i < PICKUP_MAX; i++) meshes[i].visible = false;
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
