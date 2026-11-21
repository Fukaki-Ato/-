/**
 * 失重图书馆 · 主地标与动件（docs/scenes/library-brief.md §4.1/4.4/4.5/4.7/4.10 + §11.1 步骤 4-5）：
 *   spire   万卷塔 ×2（A x−28/z−60、B x30/z−175，塔位校核 §4.1）：八角收分层带剪影（每 3.2m 明暗交替，
 *           顶点色合并单网格）+ 4 条蜡封红封条螺旋 + 每 32m 出挑回廊 + 塔基对开本台座（背路侧展开）；
 *           可见高 ≤60m；±0.1°/26s 摇曳；顶盖 3 片公转 + 微倾；灯笼错相呼吸（3~5s）。
 *   ladders 悬索书梯：跨路拱段 ×2（弧链 + 踏级，拱下净高 ~4.7m 纯视觉画框）+ 层檐垂梯 ×4 + 连塔横梯
 *           ×8（斜 20~35°）；悬链 0.5% scaleY 呼吸 + 每段随机 2 枚踏级轻晃（确定性相位）。
 *   arches  蜡封拱门 ×8（跨 8~12m，完整/半塌/断桩三态）：楔石 + 拱心径 1.6m 蜡封圆章（双环 + 章纹）+
 *           柱础书堆；完整拱净高统一 4.5m（滑铲压迫感归 high 皮，§4.7）。
 *   tunnel  反重力书阁视觉隧道 ×1 段（§3.6/§4.10，Phase A 纯视觉，真反重力 Phase B §11.2）：吊顶层板 +
 *           倒挂书架（书脊朝下五色 + 空槽证据链）+ 入口环（径 6m 斜挂 15°，0.5Hz 脉动）+ 出口章纹门。
 *   shelves 旋转书架装饰座 ×6（§4.4：mid 排 0.15~0.3 rad/s 相邻错向自转；Phase B 才是真旋转门 B-10）；
 *   falls   墨瀑 ×6（窄瀑 ×4 / 宽瀑 ×2，§3.5）：墨青丝带 UV 滚动 + 2% 金屑闪点（DataTexture 竖纹）+
 *           落点墨雾团呼吸；wave 翻页光波每 24~36s 扫过（0.9s/次）。
 * 调色按 brief §2 本地对表（library/palette.ts 并行件合入前先保 tsc 通过）。每帧零分配、确定性 rnd、LOOP/WRAP_Z 回收；发光只用烛光琥珀 HDR ×1.3。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { applyWorldBend } from '../stormspire/worldBend.js';

// ---- 调色（brief §2 七色 + §2 派生；并行件 library/palette.ts 合入前先本地对表）----
const INK_TEAL = 0x46536b, PAPER = 0xeadfc2, PAPER_OLD = 0xb3a17f, LEATHER = 0x7a5a3c,
  WAX_RED = 0xa63a2e, CANDLE = 0xffb65c, PAGE_WHITE = 0xf4ecd9, INK_MIST = 0x39445c;
const SPINE_COLORS = [PAPER, PAPER_OLD, LEATHER, INK_TEAL]; // §3.3 装帧五色去蜡封红（红走 8% 节奏点单独抽）
const AMBER = new THREE.Color(CANDLE).multiplyScalar(1.3);  // 唯一发光色 HDR：Basic 直出过 bloom
const TC = new THREE.Color();

/** 顶点色：给几何整体刷单色（万卷塔层带明暗/封条合并进单网格用） */
function tinted(geo: THREE.BufferGeometry, hex: number) {
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3); TC.setHex(hex);
  for (let i = 0; i < n; i++) { arr[i * 3] = TC.r; arr[i * 3 + 1] = TC.g; arr[i * 3 + 2] = TC.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
const V = new THREE.Vector3(), S = new THREE.Vector3();
/** 自管 compose（零分配，非均匀缩放/自转件用） */
function put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number,
  rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) {
  E.set(rx, ry, rz); Q.setFromEuler(E); V.set(x, y, z); S.set(sx, sy, sz);
  M.compose(V, Q, S); mesh.setMatrixAt(i, M);
}

/** DataTexture 收尾（竖纹/亮带共用）：sRGB + RepeatWrapping + 线性过滤 */
function finishTex(tex: THREE.DataTexture, mipmap: boolean): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = mipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmap; tex.needsUpdate = true;
  return tex;
}
/** 万卷塔可见段（≤60m）：层带剪影 + 封条 + 回廊 + 塔基台座，合并单网格 ×2 实例共享 */
function buildSpireGeo(): THREE.BufferGeometry {
  const H = 58, BH = 3.2, R0 = 13, R1 = 4.5, parts: THREE.BufferGeometry[] = [];
  const rAt = (y: number) => R0 - (R0 - R1) * (y / H);
  for (let i = 0; i < Math.round(H / BH); i++) { // 层带条纹剪影：明暗交替（陈纸米亮带微放大避免共面闪面）
    const lite = i % 2 === 1, pad = lite ? 0.18 : 0;
    const g = new THREE.CylinderGeometry(rAt((i + 1) * BH) + pad, rAt(i * BH) + pad, BH, 8);
    g.translate(0, i * BH + BH / 2, 0); parts.push(tinted(g, lite ? PAPER : LEATHER));
  }
  for (let s = 0; s < 4; s++) for (let seg = 0; seg < 8; seg++) { // 4 条蜡封红封条自底螺旋向上
    const y = seg * (H / 8), r = rAt(y) + 0.35, a = s * 1.57 + (y / H) * 1.3;
    const g = new THREE.BoxGeometry(0.5, H / 8 + 0.35, 0.32);
    g.translate(0, y + H / 16, 0); g.rotateY(a); g.translate(Math.sin(a) * r, 0, Math.cos(a) * r);
    parts.push(tinted(g, WAX_RED));
  }
  for (const cy of [32, 54]) { // 每 32m 一圈出挑回廊
    const g = new THREE.CylinderGeometry(rAt(cy) + 1.0, rAt(cy) + 1.0, 0.5, 8, 1, true);
    g.translate(0, cy, 0); parts.push(tinted(g, PAPER_OLD));
  }
  // 塔基摊开对开本台座（跨度 ~60m）：双页斜翘 + 书脊，整体在 +x 侧（塔 A 转 π 即背路展开）
  const p1 = new THREE.BoxGeometry(30, 0.9, 24).rotateZ(0.1).translate(15, 0.4, 0),
    p2 = new THREE.BoxGeometry(24, 0.9, 24).rotateZ(-0.08).translate(-12, 0.35, 0),
    spine = new THREE.BoxGeometry(3, 1.3, 25).translate(0, 0.5, 0);
  parts.push(tinted(p1, PAPER), tinted(p2, PAPER_OLD), tinted(spine, LEATHER));
  return mergeGeometries(parts);
}

/** 翻页光波亮带：页尘白软带（v 带半宽 0.03 ≈ 14m 长的亮段，带宽 3m 由平面 x 宽承担） */
function makeWaveTex(): THREE.DataTexture {
  const W = 32, H = 256, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.abs(y / H - 0.5), a = Math.max(0, 1 - (d / 0.03) * (d / 0.03)), i = (y * W + x) * 4;
    data[i] = 244; data[i + 1] = 236; data[i + 2] = 217; data[i + 3] = 255 * a * a;
  }
  return finishTex(new THREE.DataTexture(data, W, H, THREE.RGBAFormat), false);
}

/** 墨瀑竖纹：墨青→墨渊丝 + 2% 金屑闪点（抄 stormspire islands.makeFallTexture 配方改色） */
function makeInkTex(): THREE.DataTexture {
  const W = 64, H = 256, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = rnd(x, 901), thread = c > 0.55 ? 0.55 + c * 0.45 : 0.2 + c * 0.35, k = 1 - thread;
    const fleck = rnd(x * 7 + (y >> 2), 903) > 0.98 ? 1 : 0, i = (y * W + x) * 4; // 少数列=亮墨流丝，2% 金屑
    data[i] = fleck ? 255 : 30 + 40 * k; data[i + 1] = fleck ? 182 : 26 + 57 * k; data[i + 2] = fleck ? 92 : 51 + 56 * k;
    data[i + 3] = 255 * Math.min(1, 0.25 + 0.75 * Math.pow(y / H, 1.2)); // 底端渐隐溶进墨海
  }
  return finishTex(new THREE.DataTexture(data, W, H, THREE.RGBAFormat), true);
}
export function createLandmarks(scene: THREE.Scene) {
  const insts: Inst[] = [];
  // ---- 万卷塔 ×2：错 z（§4.1 塔位校核），A 转 π 使台座背路侧展开 ----
  const SP = [{ x: -28, z: -60, ry: 0 }, { x: 30, z: -175, ry: Math.PI }];
  const spireMat = new THREE.MeshLambertMaterial({ vertexColors: true }); applyWorldBend(spireMat); // 层带明暗走顶点色
  const spires = new THREE.InstancedMesh(buildSpireGeo(), spireMat, 2); // 塔基台座出塔身甚远：剔除交整 Mesh 常显
  spires.frustumCulled = false; scene.add(spires);
  const lanternMat = new THREE.MeshBasicMaterial({ color: AMBER }); applyWorldBend(lanternMat);
  const LANT = 12; // 回廊灯笼 ×12（每塔每回廊 3 盏，错相呼吸）
  const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), lanternMat, LANT);
  lanterns.frustumCulled = false; scene.add(lanterns); const fragW = [0.05 + rnd(0, 627) * 0.05, 0.05 + rnd(1, 627) * 0.05]; // 公转 0.05~0.1 rad/s
  const lanDef = Array.from({ length: LANT }, (_, i) => {
    const cy = Math.floor(i / 2) % 2 === 0 ? 32 : 54, r = 13 - 8.5 * (cy / 58) + 1.55, a = 0.6 + Math.floor(i / 4) * 2.1;
    return { x: Math.sin(a) * r, y: cy + 0.9, z: Math.cos(a) * r, per: 3 + rnd(i, 611) * 2, ph: rnd(i, 613) * 6.283 }; });
  const fragDef = Array.from({ length: 6 }, (_, i) => ({ // 顶盖碎块 ×6（每塔 3 片双坡顶掀落）
    ti: i % 2, k: Math.floor(i / 2), s: 1.2 + rnd(i, 621) * 0.7, tilt: 0.18 + rnd(i, 623) * 0.25, ph: rnd(i, 625) * 6.283 }));
  const frags = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.6, 1.3, 1.6, 3), std(LEATHER), 6);
  frags.frustumCulled = false; scene.add(frags); // 顶盖碎块网格（三棱楔 = 双坡顶碎片）

  // ---- 悬索书梯（§4.5）：拱 ×2 + 垂梯 ×4 + 横梯 ×8；链呼吸 + 随机 2 枚踏级轻晃 ----
  const ARC_R = 7.4, ARC_A = 2.4, ARC_CY = -ARC_R * Math.cos(ARC_A / 2); // 弧顶净高 7.4·(1−cos1.2)≈4.7m，跨 ≈13.8m
  const archChains = new THREE.InstancedMesh(new THREE.TorusGeometry(ARC_R, 0.05, 6, 26, ARC_A).rotateZ(Math.PI / 2 - ARC_A / 2), std(LEATHER), 4);
  archChains.frustumCulled = false; scene.add(archChains);
  interface ChainDef { x: number; y: number; z: number; rx: number; ry: number; rz: number; len: number; ph: number }
  interface StepDef { x: number; y: number; z: number; rz: number; ph: number }
  const chDefs: ChainDef[] = [], stDefs: StepDef[] = [], ARCH = [-70, -166]; // 拱段每 240m ×2
  let swaySeq = 0; const swayPh = () => (rnd(swaySeq++, 631) < 0.09 ? rnd(swaySeq, 633) * 6.283 : -1); // 每段随机 ~2 枚踏级中签
  for (const az of ARCH) for (let k = 0; k < 30; k++) { // 拱踏级沿弧挂 30 级（级距 ~0.5m）
    const th = Math.PI / 2 - ARC_A / 2 + (k / 29) * ARC_A;
    stDefs.push({ x: Math.cos(th) * ARC_R, y: Math.max(0.16, ARC_CY + Math.sin(th) * ARC_R - 0.3), z: az, rz: 0, ph: swayPh() });
  }
  for (let i = 0; i < 4; i++) { // 垂梯 ×4：书塔层檐垂向墨海（12~18m）
    const side = i % 2 === 0 ? -1 : 1, x = side * (5.6 + rnd(i, 641) * 1.2), z = -26 - i * 56, top = 12.5 + rnd(i, 643) * 3;
    const bot = -2.2, len = top - bot, mid = (top + bot) / 2;
    for (const sx of [-0.55, 0.55]) chDefs.push({ x: x + sx, y: mid, z, rx: 0, ry: 0, rz: 0, len, ph: rnd(i, 645) * 6.283 });
    for (let y = top - 0.5; y > bot; y -= 0.5) stDefs.push({ x, y, z, rz: 0, ph: swayPh() });
  }
  for (let i = 0; i < 8; i++) { // 连塔横梯 ×8：mid-far 之间斜 20~35° 远景
    const side = i % 2 === 0 ? -1 : 1, x = side * (10 + rnd(i, 651) * 8), z = -18 - i * 28 - rnd(i, 653) * 6, y0 = 9 + rnd(i, 661) * 4;
    const len = 10 + rnd(i, 655) * 4, phi = 0.35 + rnd(i, 657) * 0.25;
    for (const sx of [-0.5, 0.5]) chDefs.push({ x: x + sx, y: y0 - Math.sin(phi) * len / 2, z: z - Math.cos(phi) * len / 2, rx: Math.PI / 2 + phi, ry: 0, rz: 0, len, ph: rnd(i, 663) * 6.283 });
    for (let dI = 0.5; dI < len; dI += 0.5) stDefs.push({ x: x + (rnd(i * 31 + dI * 2 | 0, 665) - 0.5) * 0.3, y: y0 - Math.sin(phi) * dI, z: z - Math.cos(phi) * dI, rz: 0, ph: swayPh() });
  }
  const chains = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1, 0.09), std(LEATHER), chDefs.length);
  const steps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.07, 0.4), std(PAPER_OLD), stDefs.length);
  chains.frustumCulled = false; steps.frustumCulled = false; scene.add(chains); scene.add(steps);
  // ---- 蜡封拱门 ×8（§4.7）：楔石实例化 + 拱心圆章 + 柱础书堆；完整/半塌/断桩三态 ----
  interface PropDef { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number; hex: number }
  const wedges: Placement[] = [], seals: Placement[] = [], props: PropDef[] = [],
    wedgeGeo = new THREE.BoxGeometry(0.72, 0.62, 0.58); // 楔石单元
  for (let k = 0; k < 8; k++) {
    const z = -16 - k * 28 + (rnd(k, 671) - 0.5) * 6, W = 8 + rnd(k, 673) * 4;
    const hS = W / 2 - 0.5, Rc = (hS * hS + 2.3 * 2.3) / (2 * 2.3), phi = Math.asin(hS / Rc), cy = 4.5 - Rc; // 圆弧拱几何
    const sprY = cy + (Rc - 0.3) * Math.cos(phi), st = rnd(k, 675), side = rnd(k, 677) < 0.5 ? -1 : 1;
    for (let pi = 0; pi < 2; pi++) { // 两端拱脚短柱（半塌侧折矮歪斜）
      const broken = st >= 0.5 && st < 0.8 && pi === (side < 0 ? 1 : 0);
      props.push({ x: (pi === 0 ? -1 : 1) * (W / 2 - 0.35), y: broken ? sprY * 0.45 + 0.4 : sprY / 2 + 0.15, z,
        sx: 0.7, sy: broken ? sprY * 0.9 : sprY + 0.3, sz: 0.6, rx: 0, ry: 0, rz: broken ? 0.4 * side : 0, hex: LEATHER });
    }
    for (let i = 0; i < 9; i++) { // 楔石沿弧（拱心在顶）；半塌缺一侧、断桩只留拱脚两楔
      const th = Math.PI / 2 - phi + (i / 8) * phi * 2;
      if (st >= 0.5 && st < 0.8 ? side * (th - Math.PI / 2) > 0.55 : st >= 0.8 && Math.abs(th - Math.PI / 2) > 0.5) continue;
      wedges.push({ x: Math.cos(th) * (Rc - 0.3), y: cy + Math.sin(th) * (Rc - 0.3), z: z + (rnd(k * 9 + i, 679) - 0.5) * 0.1, s: 1, ry: 0, rz: th - Math.PI / 2 });
    }
    if (st >= 0.5 && st < 0.8) for (let j = 0; j < 3; j++) // 半塌侧：楔石落地斜坡
      wedges.push({ x: side * (hS + 0.6 + j * 0.8), y: Math.max(0.3, sprY - 0.5 - j * 0.55), z, s: 1, ry: 0, rz: 0.5 * side });
    // 拱心径 1.6m 蜡封圆章（断桩态：圆章坠落半埋在脚边）
    if (st < 0.8) seals.push({ x: 0, y: 4.42, z: z + 0.42, s: 1, ry: 0 });
    else seals.push({ x: side * 1.7, y: 0.3, z: z + 1.8, s: 1, ry: rnd(k, 681), rx: 1.25, rz: 0.2 * side });
    const nb = st >= 0.8 ? 2 : 3 + Math.floor(rnd(k, 683) * 3); // 柱础书堆 3~5 册（断桩散落 2 册）
    for (let b = 0; b < nb; b++) props.push({
      x: (b % 2 === 0 ? -1 : 1) * (W / 2 - 0.1) + (rnd(k * 9 + b, 685) - 0.5) * 0.5, y: 0.17 + Math.floor(b / 2) * 0.36,
      z: z + (rnd(k * 9 + b, 687) - 0.5) * 1.4, sx: 0.24 + rnd(k * 9 + b, 689) * 0.16, sy: 0.3 + rnd(k * 9 + b, 690) * 0.12,
      sz: 0.2 + rnd(k * 9 + b, 692) * 0.1, rx: 0, ry: rnd(k * 9 + b, 694) * 0.6, rz: (rnd(k * 9 + b, 696) - 0.5) * 0.3,
      hex: SPINE_COLORS[Math.floor(rnd(k * 9 + b, 698) * 3.999)] });
  }
  insts.push(addInst(scene, wedgeGeo, std(PAPER_OLD), wedges));
  const sealParts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.8, 0.8, 0.16, 18).rotateX(Math.PI / 2), // 章体 + 浮雕双环
    new THREE.TorusGeometry(0.62, 0.05, 6, 20), new THREE.TorusGeometry(0.45, 0.04, 6, 16).translate(0, 0, 0.1)];
  for (let rI = 0; rI < 8; rI++) { const a = rI * 0.785, g = new THREE.BoxGeometry(0.4, 0.07, 0.05); // 浮雕双环 + 放射章纹 ×8
    g.rotateZ(a); g.translate(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.1); sealParts.push(g);
  }
  insts.push(addInst(scene, mergeGeometries(sealParts), std(WAX_RED), seals));

  // ---- 反重力书阁视觉隧道 ×1 段：吊顶 + 倒挂书架 + 入口环 + 出口章纹门（Phase A 纯视觉）----
  const TU_Z = -128, TU_L = 80, slabGeo = mergeGeometries([new THREE.BoxGeometry(13, 0.35, TU_L).translate(0, 5.6, 0), // 吊顶层板
    new THREE.BoxGeometry(3.4, 0.16, TU_L).translate(-4, 5.3, 0), new THREE.BoxGeometry(3.4, 0.16, TU_L).translate(0, 5.3, 0),
    new THREE.BoxGeometry(3.4, 0.16, TU_L).translate(4, 5.3, 0)]); // 倒挂书架层板 ×3
  insts.push(addInst(scene, slabGeo, std(LEATHER), [{ x: 0, y: 0, z: TU_Z, s: 1, ry: 0 }])); let bookSeq = 0;
  for (const bx of [-4, 0, 4]) for (let s = -TU_L / 2 + 1; s < TU_L / 2 - 1; s += 0.7) { // 倒挂书脊（书脊朝下）
    if (rnd(++bookSeq, 691) < 0.12) continue; // 空槽 = 被取走的书（墨污之夜证据链）
    props.push({ x: bx + (rnd(bookSeq, 693) - 0.5) * 0.1, y: 5.06, z: TU_Z + s, sx: 0.18, sy: 0.3 + rnd(bookSeq, 695) * 0.1, sz: 0.24,
      rx: 0, ry: 0, rz: rnd(bookSeq, 697) < 0.08 ? 0.2 : 0, hex: rnd(bookSeq, 699) < 0.08 ? WAX_RED : SPINE_COLORS[Math.floor(rnd(bookSeq, 701) * 3.999)] });
  }
  const propMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff), props.length);
  propMesh.frustumCulled = false; scene.add(propMesh); // 拱脚柱/书堆/倒挂书脊共用（非均匀 compose）
  for (let i = 0; i < props.length; i++) propMesh.setColorAt(i, TC.setHex(props[i].hex).multiplyScalar(0.85 + rnd(i, 703) * 0.3)); // 装帧五色实例色
  if (propMesh.instanceColor) propMesh.instanceColor.needsUpdate = true;
  const ringMat = new THREE.MeshBasicMaterial({ color: AMBER }); applyWorldBend(ringMat);
  const ring = new THREE.InstancedMesh(new THREE.TorusGeometry(3, 0.2, 8, 30), ringMat, 1); // 入口倒悬漩涡环（径 6m）
  ring.frustumCulled = false; scene.add(ring);
  const gateParts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(3.2, 0.35, 8, 28).translate(0, 3.2, 0),
    new THREE.CylinderGeometry(1.15, 1.15, 0.2, 16).rotateX(Math.PI / 2).translate(0, 6.4, 0)]; // 门环 + 门顶圆章
  insts.push(addInst(scene, mergeGeometries(gateParts), std(WAX_RED), [{ x: 0, y: 0, z: TU_Z - TU_L / 2 + 1, s: 1, ry: 0 }])); // 出口章纹门
  // ---- 旋转书架装饰座 ×6（§4.4）：四翼十字 + 黄铜中柱/底座，相邻座转速/方向错开 ----
  const SH = 6;
  const shelfDef = Array.from({ length: SH }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * (8.5 + rnd(i, 711) * 4), z: -30 - i * 38 + (rnd(i, 713) - 0.5) * 8,
    spin: (0.15 + rnd(i, 715) * 0.15) * (i % 2 === 0 ? 1 : -1), rot: rnd(i, 717) * 6.283 }));
  const wings = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 3.2, 0.5), std(0xffffff), SH * 4);
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 2.5, 0.14), std(0xffffff), SH * 20);
  wings.frustumCulled = false; strips.frustumCulled = false;
  scene.add(wings); scene.add(strips);
  for (let i = 0; i < SH * 4; i++) wings.setColorAt(i, TC.setHex(i % 5 === 3 ? WAX_RED : SPINE_COLORS[i % 4]).multiplyScalar(0.85 + rnd(i, 719) * 0.3));
  for (let i = 0; i < SH * 20; i++) strips.setColorAt(i, TC.setHex(rnd(i, 721) < 0.08 ? WAX_RED : SPINE_COLORS[Math.floor(rnd(i, 723) * 3.999)]).multiplyScalar(0.85 + rnd(i, 725) * 0.3));
  if (wings.instanceColor) wings.instanceColor.needsUpdate = true; if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
  const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.11, 0.11, 3.5, 8).translate(0, 1.75, 0), // 黄铜中柱（径 0.22m）
    new THREE.CylinderGeometry(1.5, 1.6, 0.28, 12).translate(0, 0.14, 0)]); // 底座圆盘（径 3m）
  insts.push(addInst(scene, poleGeo, std(LEATHER), shelfDef.map(p => ({ x: p.x, y: 0, z: p.z, s: 1, ry: 0 }))));

  // ---- 墨瀑 ×6（§3.5）：窄瀑 ×4 + 宽瀑 ×2；丝带 UV 滚动 + 落点墨雾团呼吸 ----
  interface FallDef { x: number; y: number; z: number; w: number; h: number; ry: number }
  const fallDefs: FallDef[] = [], mistDefs: FallDef[] = [];
  for (let k = 0; k < 4; k++) { // 窄瀑 1.5~2.5m（书岛边缘）
    const side = k % 2 === 0 ? -1 : 1, w = 1.5 + rnd(k, 731), top = 7 + rnd(k, 735) * 3;
    fallDefs.push({ x: side * (9 + rnd(k, 733) * 5), y: top, z: -46 - k * 54, w, h: top, ry: side > 0 ? Math.PI : 0 });
    mistDefs.push({ x: side * (8.2 + rnd(k, 737) * 5), y: 0.6, z: -46 - k * 54, w: w * 1.9, h: 3, ry: 0 });
  }
  for (let j = 0; j < 2; j++) { // 宽瀑 4~6m（L 塔旁，垂进墨海）
    const side = j === 0 ? -1 : 1, w = 4 + rnd(j + 4, 739) * 2, top = 12 + rnd(j + 4, 741) * 2;
    fallDefs.push({ x: side * (21 + rnd(j + 4, 743) * 4), y: top, z: -100 - j * 60, w, h: top, ry: side > 0 ? Math.PI : 0 });
    mistDefs.push({ x: side * (20 + rnd(j + 4, 745) * 4), y: 0.6, z: -100 - j * 60, w: w * 1.8, h: 3, ry: 0 });
  }
  const fallTex = makeInkTex(); // 墨青丝带竖纹（顶在原点向下挂：瀑源 → 底端没入墨海）
  const fallGeo = new THREE.CylinderGeometry(1, 1.15, 1, 10, 1, true, 0, Math.PI).translate(0, -0.5, 0);
  const falls = new THREE.InstancedMesh(fallGeo, new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), fallDefs.length); // 墨瀑丝带
  falls.frustumCulled = false; scene.add(falls);
  const mistGeo = new THREE.SphereGeometry(1, 10, 6); mistGeo.scale(1, 0.4, 1);
  const mistMat = new THREE.MeshBasicMaterial({ color: INK_MIST, transparent: true, opacity: 0.45, depthWrite: false });
  const mists = new THREE.InstancedMesh(mistGeo, mistMat, mistDefs.length); // 落点墨雾团（opacity 整组呼吸）
  mists.frustumCulled = false; scene.add(mists);

  // ---- 翻页光波：3×240m 加色半透长平面 + 确定性 z 循环（§6 新增行）----
  const WAVE_T = 24 + rnd(3, 751) * 12, WAVE_OFF = rnd(3, 753) * WAVE_T, waveTex = makeWaveTex();
  const waveMat = new THREE.MeshBasicMaterial({ color: PAGE_WHITE, map: waveTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  applyWorldBend(waveMat); // 贴路面亮带与地面同弯
  const wave = new THREE.Mesh(new THREE.PlaneGeometry(3, 240).rotateX(-Math.PI / 2), waveMat);
  wave.position.set(0, 0.07, -104); scene.add(wave);

  return {
    update(move: number, t: number) {
      for (const inst of insts) { // 静态件回收（楔石/圆章/吊顶/章纹门/中柱底座）
        for (const p of inst.items) { p.z += move; if (p.z > WRAP_Z) p.z -= LOOP; }
        writeAll(inst); }
      const zShift = (z: number) => { const nz = z + move; return nz > WRAP_Z ? nz - LOOP : nz; };
      for (let i = 0; i < 2; i++) // 万卷塔：错 z 回收 + ±0.1°/26s 极缓摇曳（相位错开）
        put(spires, i, SP[i].x, 0, zShift(SP[i].z), 0, SP[i].ry, 0.00175 * Math.sin(t * 0.242 + i * 1.7), 1, 1, 1);
      for (let i = 0; i < 6; i++) { const f = fragDef[i], sp = SP[f.ti], a = t * fragW[f.ti] + f.k * 2.094 + f.ph; // 顶盖碎块：0.05~0.1 rad/s 公转 + 微倾悬浮
        put(frags, i, sp.x + Math.cos(a) * 5.4 * f.s, 59.4 + Math.sin(t * 0.4 + f.k) * 0.5, zShift(sp.z) + Math.sin(a) * 5.4 * f.s, f.tilt, a, 0.14, f.s, f.s, f.s);
      }
      for (let i = 0; i < LANT; i++) { const l = lanDef[i], sp = SP[i % 2], s = 1 + Math.sin(t * 6.283 / l.per + l.ph) * 0.12; // 回廊灯笼：按层带错相呼吸（3~5s，1±0.12）
        put(lanterns, i, sp.x + l.x, l.y, zShift(sp.z) + l.z, 0, 0, 0, s, s, s);
      }
      for (let i = 0; i < 4; i++) // 拱弧链 ×4：0.5% scaleY 呼吸
        put(archChains, i, 0, ARC_CY, zShift(ARCH[Math.floor(i / 2)]) + (i % 2) * 0.6 - 0.3, 0, 0, 0, 1, 1 + Math.sin(t * 1.1 + i) * 0.005, 1);
      for (let i = 0; i < chDefs.length; i++) { const c = chDefs[i]; // 垂梯/横梯悬链：呼吸 + 梯轴倾角
        put(chains, i, c.x, c.y, zShift(c.z), c.rx, c.ry, c.rz, 1, c.len * (1 + Math.sin(t * 1.1 + c.ph) * 0.005), 1);
      }
      for (let i = 0; i < stDefs.length; i++) { const st = stDefs[i]; // 踏级：整列随世界回收 + 中签级 rx ±0.04（3s 周期）
        put(steps, i, st.x, st.y, zShift(st.z), st.ph >= 0 ? Math.sin(t * 2.094 + st.ph) * 0.04 : 0, 0, st.rz, 1, 1, 1);
      }
      for (let i = 0; i < props.length; i++) { const p = props[i]; // 拱脚柱/书堆/倒挂书脊：非均匀随世界回收
        put(propMesh, i, p.x, p.y, zShift(p.z), p.rx, p.ry, p.rz, p.sx, p.sy, p.sz);
      }
      for (let sI = 0; sI < SH; sI++) { const sd = shelfDef[sI], rot = sd.rot + t * sd.spin, cz = zShift(sd.z); // 旋转书架自转（装饰，Phase B 才是真旋转门）
        for (let w = 0; w < 4; w++) {
          const A = rot + w * 1.5708, dx = Math.cos(A), dz = -Math.sin(A), px = Math.sin(A), pz = Math.cos(A);
          put(wings, sI * 4 + w, sd.x + dx * 1.1, 1.75, cz + dz * 1.1, 0, A, 0, 1, 1, 1);
          for (let j = 0; j < 5; j++) { const u = -0.8 + j * 0.4, li = sI * 20 + w * 5 + j; // 书脊条贴翼面外缘
            put(strips, li, sd.x + dx * 1.42 + px * u, 1.62 + (li % 3) * 0.14, cz + dz * 1.42 + pz * u, 0, A, 0, 1, 1, 1); }
        }
      }
      spires.instanceMatrix.needsUpdate = true; frags.instanceMatrix.needsUpdate = true; lanterns.instanceMatrix.needsUpdate = true;
      archChains.instanceMatrix.needsUpdate = true; chains.instanceMatrix.needsUpdate = true; steps.instanceMatrix.needsUpdate = true;
      propMesh.instanceMatrix.needsUpdate = true; wings.instanceMatrix.needsUpdate = true; strips.instanceMatrix.needsUpdate = true;
      fallTex.offset.y = (fallTex.offset.y + move * 0.03) % 1; // UV 下滚 = 墨流下行（stormspire islands 口径）
      for (let i = 0; i < fallDefs.length; i++) { const f = fallDefs[i], m = mistDefs[i]; // 墨瀑丝带回收 + 落点墨雾团贴落点
        f.z += move; if (f.z > WRAP_Z) f.z -= LOOP; m.z = f.z;
        put(falls, i, f.x, f.y, f.z, 0, f.ry, 0, f.w / 2, f.h, f.w / 2);
        put(mists, i, m.x, m.y + Math.sin(t * 0.9 + i) * 0.15, m.z, 0, 0, 0, m.w, 3, m.w);
      }
      falls.instanceMatrix.needsUpdate = true; mists.instanceMatrix.needsUpdate = true;
      mistMat.opacity = 0.45 + Math.sin(t * 0.8) * 0.1; // 落点墨雾团呼吸 0.35→0.55
      const rs = 1 + Math.sin(t * Math.PI) * 0.05; // 入口环 0.5Hz 微光脉动（缩放吞吐）
      put(ring, 0, 0, 4.9, zShift(TU_Z + TU_L / 2 - 1), 0, 0, 0.26, rs, rs, rs); ring.instanceMatrix.needsUpdate = true; // 斜挂 15°
      const ph = (t + WAVE_OFF) % WAVE_T; // 翻页光波：24~36s 确定性相位，0.9s 从远(v1)扫到近(v0)
      if (ph < 0.9) { waveMat.opacity = 0.5; waveTex.offset.y = -0.6 + (ph / 0.9) * 1.2; } else waveMat.opacity = 0;
    },
  };
}
