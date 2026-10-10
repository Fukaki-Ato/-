/**
 * 主界面背景（issue #12：按经过时间推进、离开页面暂停、不额外创建 renderer/帧循环）。
 *
 * Web 端背景是 15 秒循环视频（壳层建 <video> 包成 VideoTexture 注入，本包零 DOM）；
 * 微信端没有 <video> 通路，注入的是同一构图静态图 menu-bg.png，本模块两边同一套代码。
 *
 * 铺法：视频原样 cover 满整个视口（等比放大到短边贴合、长边超出居中裁掉），
 * 不加任何静态补图——不镜像补两侧、不用纯色帽补顶，画面 100% 来自视频本身。
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
): MenuBackdrop {
  const meshes: THREE.Mesh[] = [];

  const plane = (tex: THREE.Texture, w: number, h: number, order: number, opacity = 1): THREE.Mesh => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: opacity < 1, opacity, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.renderOrder = order;
    mesh.position.z = -12;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // ---- 背景主体：视频原样铺满整个视口（等比放大到 cover、居中裁切多余的一边） ----
  // 不再加任何静态补图：不镜像补两侧、不用纯色帽补顶，画面 100% 来自视频本身。
  const texW = set.main.texSize.w;
  const texH = set.main.texSize.h;
  unflip(set.main.texture as THREE.Texture);
  const main = plane(set.main.texture as THREE.Texture, texW, texH, -30);
  // ---- 循环接缝覆盖层：起点帧，与背景同一 cover 变换，淡入淡出盖住跳转 ----
  let cover: THREE.Mesh | null = null;
  let coverMat: THREE.MeshBasicMaterial | null = null;
  if (set.loopCover && set.seconds) {
    unflip(set.loopCover.texture as THREE.Texture);
    cover = plane(set.loopCover.texture as THREE.Texture, texW, texH, -28, 0);
    coverMat = cover.material as THREE.MeshBasicMaterial;
  }

  return {
    step(): void {
      // 每帧从相机读视口：宿主 resize 后无需重建即自适应（正交相机 left=0/top=0）
      const vw = camera.right;
      const vh = -camera.bottom;
      const k = Math.max(vw / texW, vh / texH);   // cover：短边贴合、长边超出居中裁掉
      main.scale.setScalar(k);
      main.position.set(vw / 2, -vh / 2, -12);
      if (cover && coverMat && set.loopCover && set.seconds && set.time) {
        const f = loopFade(set.time(), set.seconds);
        cover.visible = f > 0.002;
        coverMat.opacity = f;
        cover.scale.setScalar(k);
        cover.position.set(vw / 2, -vh / 2, -12);
      } else if (cover) {
        cover.visible = false;
      }
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
