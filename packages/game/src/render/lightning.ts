/**
 * 雷电特效（闪电圈 zap 的表现层，用户要求「天上一个雷电打下来到那个地方、场景变亮」，
 * 对标 MC 闪电）：三段式——
 *   1. 天→地锯齿闪电（pool 化，每帧随机隐去部分小节 = 频闪断枝；两端直、中段抖）；
 *   2. 打击点局部点光（随赛道滚动，快速衰减）；
 *   3. 全场闪白（约 0.26s 衰减）：调用方把返回值应用到半球光/主光强度与背景、雾色。
 * 只读事件位置（lane/worldZ），不反写 sim；随机只在渲染层（不影响确定性玩法），每帧零分配。
 */
import * as THREE from 'three';

/** 可供同时播放的闪电数（闪电圈每 200m 一枚，实战几乎不会叠打；留 3 档防连点） */
const BOLT_POOL = 3;
/** 每道闪电的分节数（点数为节数+1；两端直、中段抖） */
const SEGS = 9;
/** 闪电起点高度（米）：高空入画，玩家能看到「从天上打下来」 */
const SKY_Y = 22;
/** 闪电存活时长（秒）：MC 式频闪 */
const BOLT_LIFE_S = 0.3;
/** 中段横向抖动幅度（米） */
const JITTER_M = 1.15;
/** 全场闪白：峰值与衰减时长（秒） */
export const FLASH_PEAK = 1;
const FLASH_DECAY_S = 0.26;
/** 闪白色（冷白微蓝，与主题 flashColor 同族）：供调用方插值背景/雾 */
export const FLASH_TINT = 0xcfe4ff;
/** 灯光闪白增益（半球光/主光在基线上的附加强度） */
export const FLASH_LIGHT_GAIN = 2.6;
/** 打击点点光峰值强度 */
const IMPACT_LIGHT_PEAK = 26;

const UP = new THREE.Vector3(0, 1, 0);

export interface LightningFx {
  /** 在指定车道/世界深度触发一次雷击（事件驱动，无随机延迟） */
  strike(lane: number, worldZ: number, laneWidth: number): void;
  /** 每帧推进，返回当前闪白强度 0..1（调用方应用到灯光/背景/雾） */
  update(dt: number, dist: number): number;
  /** 场景销毁时释放（几何/材质/灯光） */
  dispose(): void;
}

export function createLightningFx(scene: THREE.Scene): LightningFx {
  const segGeo = new THREE.BoxGeometry(1, 1, 1);
  interface Bolt {
    group: THREE.Group;
    segs: THREE.Mesh[];
    glows: THREE.Mesh[];
    coreMat: THREE.MeshBasicMaterial;
    glowMat: THREE.MeshBasicMaterial;
    /** 雷击点坐标：x=车道横坐标（世界），worldZ=赛道深度（渲染 z=worldZ-dist 逐帧滚动） */
    x: number; worldZ: number;
    /** 剩余寿命（<=0 = 空闲） */
    life: number;
  }
  const bolts: Bolt[] = [];
  for (let i = 0; i < BOLT_POOL; i++) {
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xeaf4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const segs: THREE.Mesh[] = [], glows: THREE.Mesh[] = [];
    for (let s = 0; s < SEGS; s++) {
      const m = new THREE.Mesh(segGeo, coreMat);
      m.visible = false; group.add(m); segs.push(m);
      const g = new THREE.Mesh(segGeo, glowMat);
      g.visible = false; group.add(g); glows.push(g);
    }
    bolts.push({ group, segs, glows, coreMat, glowMat, x: 0, worldZ: 0, life: 0 });
  }
  const impactLight = new THREE.PointLight(0xdfe9ff, 0, 16, 2);
  impactLight.visible = false;
  scene.add(impactLight);

  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), dir = new THREE.Vector3(), mid = new THREE.Vector3();
  let flashLeft = 0;

  /** 生成一道从天到落点的锯齿折线并摆好各小节（两端直、中段抖；调用方的 group 已定位到落点） */
  function shape(b: Bolt) {
    const pts: number[][] = [];
    pts.push([b.x + (Math.random() - 0.5) * 0.3, SKY_Y, 0]);
    for (let s = 1; s < SEGS; s++) {
      const k = s / SEGS;
      const amp = JITTER_M * Math.sin(Math.PI * k); // 中段抖、两端收敛
      pts.push([b.x + (Math.random() - 0.5) * 2 * amp, (1 - k) * SKY_Y, (Math.random() - 0.5) * 0.6 * amp]);
    }
    pts.push([b.x, 0, 0]);
    for (let s = 0; s < SEGS; s++) {
      p0.set(pts[s]![0], pts[s]![1], pts[s]![2]);
      p1.set(pts[s + 1]![0], pts[s + 1]![1], pts[s + 1]![2]);
      dir.subVectors(p1, p0);
      const len = dir.length() || 0.001;
      mid.addVectors(p0, p1).multiplyScalar(0.5);
      dir.divideScalar(len);
      for (const [ms, thick] of [[b.segs[s], 0.07], [b.glows[s], 0.2]] as const) {
        ms.visible = true;
        ms.position.copy(mid);
        ms.scale.set(thick, len, thick);
        ms.quaternion.setFromUnitVectors(UP, dir);
      }
    }
  }

  return {
    strike(lane: number, worldZ: number, laneWidth: number) {
      const b = bolts.find(x => x.life <= 0) ?? bolts[0]; // 全忙时复用最早一槽（叠打不丢特效）
      b.x = lane * laneWidth;
      b.worldZ = worldZ;
      b.life = BOLT_LIFE_S;
      b.group.visible = true;
      b.group.position.set(0, 0, 0);
      shape(b);
      flashLeft = FLASH_DECAY_S;
      impactLight.visible = true;
    },

    update(dt: number, dist: number) {
      let flash = 0;
      if (flashLeft > 0) flashLeft = Math.max(0, flashLeft - dt);
      flash = flashLeft <= 0 ? 0 : FLASH_PEAK * (flashLeft / FLASH_DECAY_S) ** 1.5; // 前亮后弱，快速回落
      for (const b of bolts) {
        if (b.life <= 0) continue;
        b.life -= dt;
        const z = b.worldZ - dist;
        b.group.position.z = z; // 雷电锚定闪电圈：随赛道滚动，不飘在身后
        if (b.life <= 0) {
          b.group.visible = false;
          for (const m of [...b.segs, ...b.glows]) m.visible = false;
          continue;
        }
        // MC 式频闪：整组忽明忽暗 + 随机断枝（每帧重掷，60fps 下即高压电弧效果）
        const strobe = Math.random() < 0.35 ? 0.15 : 1;
        const fade = Math.min(1, b.life / (BOLT_LIFE_S * 0.5));
        b.coreMat.opacity = strobe * fade;
        b.glowMat.opacity = strobe * fade * 0.5;
        for (let s = 0; s < SEGS; s++) {
          b.segs[s].visible = Math.random() > 0.25;
          b.glows[s].visible = b.segs[s].visible;
        }
      }
      const anyAlive = bolts.some(b => b.life > 0);
      impactLight.visible = anyAlive;
      if (anyAlive) {
        impactLight.intensity = IMPACT_LIGHT_PEAK * Math.max(flash, 0.25);
        const newest = bolts.reduce((a, b) => (b.life > a.life ? b : a));
        impactLight.position.set(newest.x, 0.4, newest.worldZ - dist);
      }
      return flash;
    },

    dispose() {
      segGeo.dispose();
      for (const b of bolts) {
        b.coreMat.dispose(); b.glowMat.dispose();
        scene.remove(b.group);
      }
      scene.remove(impactLight);
      impactLight.dispose();
    },
  };
}
