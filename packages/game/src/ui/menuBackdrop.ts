/**
 * 主界面背景（issue #12：按经过时间推进、离开页面暂停、不额外创建 renderer/帧循环）。
 *
 * Web 端背景是 15 秒循环视频（壳层建 <video> 包成 VideoTexture 注入，本包零 DOM）；
 * 微信端没有 <video> 通路，注入的是同一构图静态图 menu-bg.png，本模块两边同一套代码。
 *
 * 对位原则：背景按「与 UI 同一个 s=min(vw/1024,vh/1536)、底边贴视口底」铺，宽度按贴图
 * 自身比例算（视频 9:16 比设计 2:3 窄）；竖屏多出来的高度由顶部纯色天空帽吸收
 * （实心段 + 30px 渐隐段压住背景顶边），横屏/窄画幅两侧缺口用 MirroredRepeat 镜像外延。
 *
 * 循环接缝：源片镜头缓慢漂移、首尾不接。用「起点帧覆盖层」做淡入淡出——播到末段
 * fadeSec 内把起点帧淡入盖住视频，视频在起点处完成跳转后再把起点帧淡出 ⇒ 接缝不可见。
 * 时间→不透明度是纯函数 loopFade，可脱离 GL 用假时钟单测。
 */
import * as THREE from 'three';
import type { NinePatchSource } from '@tr/framework/ui/index.js';

/** 壳层加载注入的贴图 */
export interface BackdropSet {
  /** 背景：Web 为 VideoTexture，微信/兜底为静态图 */
  main: NinePatchSource;
  /** 视频时长 s（缺省＝静态图，不做循环淡入淡出） */
  seconds?: number;
  /** 起点帧覆盖图（与视频同构图）；配 seconds 用 */
  loopCover?: NinePatchSource;
  /** 读当前播放时刻 s（壳层注入；纯函数化便于单测，本包不碰 DOM） */
  time?(): number;
}

/** 静态图的像素尺寸（视频按自身贴图比例算宽，不用这个） */
export const BG_DESIGN = { w: 1007, h: 1562 };
/** 顶部天空帽颜色，取样自 menu-bg (500,4) 的 #4dbbf2 */
const SKY_CAP_RGB = 0x4dbbf2;
/** 循环接缝淡入淡出时长 s */
export const LOOP_FADE_S = 1.2;

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 起点帧覆盖层的不透明度：末段 [P-F, P] 线性淡入到 1，首段 [0, F] 从 1 淡出到 0，
 * 中间为 0。P 处（视频跳回 0）两侧都等于 1 ⇒ 循环边界连续不跳变。
 */
export function loopFade(tSec: number, periodSec: number, fadeSec = LOOP_FADE_S): number {
  const P = Math.max(0.001, periodSec);
  const F = Math.min(fadeSec, P / 2);
  const t = mod(tSec, P);
  if (t >= P - F) return (t - (P - F)) / F;
  if (t <= F) return 1 - t / F;
  return 0;
}

export interface MenuBackdrop {
  step(tSec: number): void;
  dispose(): void;
}

/** ImageBitmap 上传不吃 UNPACK_FLIP_Y（行 0＝图顶），标准材质的 v=0 在底 ⇒ 翻 UV */
function unflip(tex: THREE.Texture): void {
  tex.repeat.y = -Math.abs(tex.repeat.y || 1);
  tex.offset.y = 1;
  tex.needsUpdate = true;
}

export function createMenuBackdrop(
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  set: BackdropSet,
  vw0: number,
  vh0: number,
): MenuBackdrop {
  const meshes: THREE.Mesh[] = [];
  const s0 = Math.min(vw0 / 1024, vh0 / 1536);
  const aspect = set.main.texSize.w / Math.max(1, set.main.texSize.h);

  const plane = (tex: THREE.Texture, w: number, h: number, order: number, opacity = 1): THREE.Mesh => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: opacity < 1, opacity, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.renderOrder = order;
    mesh.position.z = -12;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // ---- 背景主体：与 UI 同 s、底边贴视口底、宽按贴图比例 ----
  unflip(set.main.texture as THREE.Texture);
  const bgH0 = BG_DESIGN.h * s0;
  const main = plane(set.main.texture as THREE.Texture, bgH0 * aspect, bgH0, -30);
  // ---- 循环接缝覆盖层：起点帧，淡入淡出盖住跳转 ----
  let cover: THREE.Mesh | null = null;
  let coverMat: THREE.MeshBasicMaterial | null = null;
  if (set.loopCover && set.seconds) {
    unflip(set.loopCover.texture as THREE.Texture);
    cover = plane(set.loopCover.texture as THREE.Texture, bgH0 * aspect, bgH0, -28, 0);
    coverMat = cover.material as THREE.MeshBasicMaterial;
  }
  // ---- 顶部天空帽：实心段吃多余高度 + 30px 渐隐段压住背景顶边 ----
  // three 的 alphaMap 取绿通道：行0=v0=底透明、行1=顶不透明
  const fade = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 0, 255, 0, 255]), 1, 2, THREE.RGBAFormat);
  fade.needsUpdate = true;
  fade.magFilter = THREE.LinearFilter;
  fade.minFilter = THREE.LinearFilter;   // 1×2 不能生成 mipmap，否则 alphaMap 采样失败整块透明
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: SKY_CAP_RGB, depthWrite: false, depthTest: false }));
  const capFade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: SKY_CAP_RGB, transparent: true, alphaMap: fade, depthWrite: false, depthTest: false }));
  for (const m of [cap, capFade]) {
    m.renderOrder = -29;
    m.position.z = -12;
    scene.add(m);
    meshes.push(m);
  }
  // ---- 两侧缺口：MirroredRepeat 把靠边 35% 镜像外延（椰树框景自然续出去） ----
  const sideMesh = (offsetX: number, repeatX: number): THREE.Mesh => {
    const tex = (set.main.texture as THREE.Texture).clone();
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.repeat.set(repeatX, -1);
    tex.offset.set(offsetX, 1);
    tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false }));
    m.renderOrder = -29;
    m.position.z = -12;
    scene.add(m);
    meshes.push(m);
    return m;
  };
  const sideL = sideMesh(0.35, -0.35);
  const sideR = sideMesh(1.0, 0.35);

  return {
    step(): void {
      // 每帧从相机读视口：宿主 resize 后无需重建即自适应（正交相机 left=0/top=0）
      const vw = camera.right || vw0;
      const vh = -camera.bottom || vh0;
      const s = Math.min(vw / 1024, vh / 1536);
      const bgW = BG_DESIGN.h * s * aspect;
      const bgH = BG_DESIGN.h * s;
      const bgTop = vh - bgH;                          // 底边贴视口底
      main.scale.setScalar(s / s0);
      main.position.set(vw / 2, -(bgTop + bgH / 2), -12);
      if (cover && coverMat && set.loopCover && set.seconds && set.time) {
        const k = loopFade(set.time(), set.seconds);
        cover.visible = k > 0.002;
        coverMat.opacity = k;
        cover.scale.setScalar(s / s0);
        cover.position.set(vw / 2, -(bgTop + bgH / 2), -12);
      } else if (cover) {
        cover.visible = false;
      }
      const gapTop = Math.max(0, bgTop);
      const fadeH = 30 * s;
      cap.visible = gapTop > 1;
      cap.scale.set(vw, Math.max(1, gapTop), 1);
      cap.position.set(vw / 2, -gapTop / 2, -12);
      capFade.visible = gapTop > 1;
      capFade.scale.set(vw, fadeH, 1);
      capFade.position.set(vw / 2, -(gapTop + fadeH / 2), -12);
      const gapX = Math.max(0, (vw - bgW) / 2);
      sideL.visible = gapX > 1;
      sideR.visible = gapX > 1;
      sideL.scale.set(Math.max(1, gapX), vh, 1);
      sideR.scale.set(Math.max(1, gapX), vh, 1);
      sideL.position.set((vw - bgW) / 4, -vh / 2, -12);
      sideR.position.set(vw - (vw - bgW) / 4, -vh / 2, -12);
    },
    dispose(): void {
      for (const m of meshes) {
        scene.remove(m);
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.alphaMap?.dispose();
        const shared = [set.main.texture, set.loopCover?.texture].filter(Boolean) as THREE.Texture[];
        if (mat.map && !shared.includes(mat.map)) mat.map.dispose();
        mat.dispose();   // 背景/覆盖贴图归壳层，不在此 dispose
      }
    },
  };
}
