/**
 * 主界面分层背景动效（issue #12：轻柔连续循环、循环边界不跳变、按经过时间推进、
 * 离开页面暂停、不额外创建 renderer/帧循环）。
 *
 * 实现：three 网格直接挂进 UiHost 现有场景（host.overlay.scene 与 mount(view,{frame})
 * 逐帧回调在 origin/main 就是公开能力，故本模块不改框架公共 API），垫在 UI 舞台后面
 * （z=-10 + 负 renderOrder）。层＝两条无缝云条（UV RepeatWrapping 循环位移）+
 * 海岸浪花带（周期平移）+ 三只错峰海鸥（飞入/飞出带淡入淡出）；棕榈为烘焙静态
 * （issue 允许「树干基本固定」）。
 *
 * 时间→位姿全部是纯函数（mod 取模保证循环连续），可脱离 GL 用假时钟单测。
 */
import * as THREE from 'three';
import type { NinePatchSource } from '@tr/framework/ui/index.js';

/** 壳层加载注入的动效贴图（云条/浪花带为横向无缝周期条） */
export interface BackdropSet {
  cloudA: NinePatchSource;
  cloudB: NinePatchSource;
  foam: NinePatchSource;
  gulls: NinePatchSource[];
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 平铺层 UV 偏移：speed px/s、period px 一个循环；取模 ⇒ 循环边界连续不跳变 */
export function loopOffset(tSec: number, speedPxPerS: number, periodPx: number): number {
  const p = Math.abs(periodPx) || 1;
  return mod(tSec * speedPxPerS, p);
}

export interface GullSpec {
  /** 一个完整周期 s（飞行窗口 + 屏外休息） */
  period: number;
  /** 错峰相位 s */
  delay: number;
  /** 巡航高度（屏高比例） */
  yFrac: number;
  /** 相对屏宽的缩放 */
  scale: number;
}

export interface GullPose { x: number; y: number; alpha: number; visible: boolean }

/** 海鸥位姿：周期内前 62% 飞越屏幕（左入右出 + 轻微起伏 + 进出场淡入淡出），其余屏外 */
export function gullPose(tSec: number, g: GullSpec): GullPose {
  const local = mod(tSec - g.delay, g.period);
  const fly = g.period * 0.62;
  if (local >= fly) return { x: 0, y: 0, alpha: 0, visible: false };
  const u = local / fly;
  const x = -0.12 + u * 1.24;
  const y = g.yFrac + Math.sin(u * Math.PI * 2) * 0.012;
  const alpha = Math.max(0, Math.min(1, u / 0.12, (1 - u) / 0.12));
  return { x, y, alpha, visible: true };
}

export const GULLS: GullSpec[] = [
  { period: 26, delay: 0, yFrac: 0.30, scale: 1.0 },
  { period: 31, delay: 9, yFrac: 0.22, scale: 0.72 },
  { period: 23, delay: 16, yFrac: 0.38, scale: 0.55 },
];

const CLOUD_A_SPEED = 14;   // px/s 低空积云
const CLOUD_B_SPEED = 7;    // px/s 高空卷云更慢＝视差
const FOAM_SPEED = 22;      // px/s 浪花带

export interface MenuBackdrop {
  step(tSec: number): void;
  dispose(): void;
}

interface TileLayer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
  /** 单个周期条在世界坐标的宽度 px（offset 换算用：content = px/tileW + offset） */
  tileW: number;
  speed: number;
  yFrac: number;
}

export function createMenuBackdrop(
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  set: BackdropSet,
  vw0: number,
  vh0: number,
): MenuBackdrop {
  const tiles: TileLayer[] = [];
  const meshes: THREE.Mesh[] = [];

  const addTile = (src: NinePatchSource, wFrac: number, yFrac: number, speed: number, opacity: number): void => {
    const tex = src.texture as THREE.Texture;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    const tileW = vw0 * wFrac;
    const planeW = vw0 + tileW;                       // 多铺一个周期当滚动余量
    const aspect = src.texSize.h / Math.max(1, src.texSize.w);
    const geo = new THREE.PlaneGeometry(planeW, tileW * aspect);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, depthTest: false });
    mat.map!.repeat.set(planeW / tileW, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((vw0 - tileW) / 2, -vh0 * yFrac, -10);
    mesh.renderOrder = -10 - tiles.length;
    scene.add(mesh);
    meshes.push(mesh);
    tiles.push({ mesh, mat, tex, tileW, speed, yFrac });
  };
  addTile(set.cloudB, 1.15, 0.10, CLOUD_B_SPEED, 0.75);
  addTile(set.cloudA, 1.30, 0.30, CLOUD_A_SPEED, 0.9);
  addTile(set.foam, 0.80, 0.80, FOAM_SPEED, 0.55);

  const gulls = GULLS.slice(0, set.gulls.length).map((spec, i) => {
    const src = set.gulls[i]!;
    const tex = src.texture as THREE.Texture;
    const aspect = src.texSize.h / Math.max(1, src.texSize.w);
    const h = vh0 * 0.035 * spec.scale;
    const geo = new THREE.PlaneGeometry(h / aspect, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -5;
    mesh.visible = false;
    scene.add(mesh);
    meshes.push(mesh);
    return { spec, mesh, mat };
  });

  return {
    step(tSec: number): void {
      // 每帧从相机读视口：宿主 resize 后无需重建即自适应（正交相机 left=0/top=0）
      const vw = camera.right || vw0;
      const vh = -camera.bottom || vh0;
      const sx = vw / vw0;
      const sy = vh / vh0;
      for (const l of tiles) {
        const period = l.tileW * sx;
        l.mesh.scale.x = sx;
        l.mesh.position.x = (vw - period) / 2;
        l.mesh.position.y = -vh * l.yFrac;
        l.tex.offset.x = loopOffset(tSec, l.speed, period) / period;
      }
      for (const g of gulls) {
        const p = gullPose(tSec, g.spec);
        g.mesh.visible = p.visible;
        if (!p.visible) continue;
        g.mesh.scale.set(sy, sy, 1);
        g.mesh.position.set(p.x * vw, -p.y * vh, -8);
        g.mat.opacity = p.alpha;
      }
    },
    dispose(): void {
      for (const m of meshes) {
        scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();   // 贴图归壳层，不在此 dispose
      }
      tiles.length = 0;
    },
  };
}
