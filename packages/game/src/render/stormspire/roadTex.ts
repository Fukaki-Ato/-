/**
 * 天穹雷脊湿路水洼粗糙度图（只供 stormspire：trackVisuals 的 stormspire 分支调用，其它主题不调）。
 * 128² DataTexture，确定性 sin-hash（与 trackVisuals.makeGroundTexture 同族配方，无 Math.random），构建期一次生成。
 * 粗糙度值域（写入 RGB 同值；three 的 roughnessMap 只读 G 通道，并与 material.roughness **相乘**，
 * 故调用方挂图时须把基线 roughness 调 1.0，绝对值全部由图承载）：
 *   基底沥青 0.92 → 灰 235；水洼核心 0.15 → 灰 38；边缘 2m 渐变带在两值间平滑插值。
 * 一块纹理覆盖「路宽 × 路向 60m」：repeat.y = 240/60 = 4 随路面平铺，调用方按 dist 滚动 offset（同地面相位公式）。
 * 路向纹素 ≈0.47m（水洼核心 4~10 纹素），横向 ≈0.03m：椭圆按路面世界坐标（米）计算，线性过滤 + mipmap 下足够柔和。
 * 水洼口径：10 片（8~12 取中）沿路向拉长的椭圆条斑——纵半径 1~2.5m（⇒ 尺度 2~5m），横半径 0.2~0.45m
 * （真实积水沿路纵向拉长，横向压窄以守得住干燥带），圆心锁在 |x| 0.74~0.92 半宽的路缘带，
 * 中线附近保持干燥——玩家视线焦点区不上斑。
 */
import * as THREE from 'three';

/** 一块纹理覆盖的路向长度（米）：trackVisuals 据此设滚动相位 */
export const ROAD_TILE_M = 60;

const N = 128;
const ROUGH_DRY = 235; // 基底沥青 roughness 0.92
const ROUGH_WET = 38;  // 水洼核心 roughness 0.15

/** smoothstep（0~1 截断）：水洼边缘渐变与外侧带掩码共用 */
function fade(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function makeRoadRoughnessTexture(roadWidth: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const half = roadWidth / 2;
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  // 10 片水洼参数（左右交替铺开，全确定性 hash）：cx 0.74~0.92 半宽 / 纵半径 1~2.5m / 横半径 0.2~0.45m
  const PUDS = 10;
  const cx: number[] = [], cz: number[] = [], rx: number[] = [], rz: number[] = [];
  for (let k = 0; k < PUDS; k++) {
    cx.push((k % 2 === 0 ? 1 : -1) * half * (0.74 + hash(k, 1) * 0.18));
    cz.push(hash(k, 2) * ROAD_TILE_M);
    rx.push(0.2 + hash(k, 3) * 0.25);
    rz.push(1 + hash(k, 4) * 1.5);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = ((x + 0.5) / N - 0.5) * roadWidth; // 纹素 → 路面世界坐标（米）
    const wz = ((y + 0.5) / N) * ROAD_TILE_M;
    let wet = 0;
    for (let k = 0; k < PUDS; k++) {
      let dz = Math.abs(wz - cz[k]);
      dz = Math.min(dz, ROAD_TILE_M - dz);       // 平铺接缝环绕：跨 60m 缝的水洼不断裂
      const d = Math.hypot((wx - cx[k]) / rx[k], dz / rz[k]); // 椭圆归一距离（核心边界 = 1）
      wet = Math.max(wet, 1 - fade((d - 1) * rz[k] / 2));     // 边缘 2m 渐变带（沿路向 2m，横向随椭圆比自然收窄）
    }
    // 横向掩码兜底：|x| < 0.5 半宽全干（中线绝对干燥），0.5~0.6 半宽渐入——水洼及其渐变尾全锁在路缘外侧 40% 带
    wet *= fade((Math.abs(wx) / half - 0.5) / 0.1);
    const g = Math.round(ROUGH_DRY + (ROUGH_WET - ROUGH_DRY) * wet);
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = g;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.repeat.set(1, 240 / ROAD_TILE_M); // 整条 240m 路向平铺 4 块
  tex.needsUpdate = true;
  return tex;
}
