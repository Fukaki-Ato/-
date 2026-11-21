/** 海湾的远/中/近景构件。全部合并进 body 桶，共享原场景材质，无贴图、无实时阴影。 */
import * as THREE from 'three';
import { type Diorama, rnd } from '../konbini/kit.js';
import { P } from './palette.js';

/** 不规则椭圆轮廓：低矮岛脊而非一排球，三个高度环之间保持大块安静的面。 */
function land(d: Diorama, x: number, z: number, rx: number, rz: number, h: number): void {
  const n = 18, positions: number[] = [], indices: number[] = [];
  const rings = [[1, 0.08], [0.8, h * 0.35], [0.38, h]];
  for (let k = 0; k < rings.length; k++) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, [r, y] = rings[k];
    const wobble = 1 + 0.09 * Math.sin(a * 3 + 0.4) + 0.05 * Math.cos(a * 5);
    positions.push(Math.cos(a) * rx * r * wobble,
      y * (0.8 + 0.2 * Math.cos(a * 2)), Math.sin(a) * rz * r * wobble);
  }
  positions.push(0, h * 0.92, 0);
  for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = k * n + i, b = k * n + j;
    indices.push(a, b + n, b, a, a + n, b + n);
  }
  for (let i = 0; i < n; i++) indices.push(2 * n + i, 3 * n, 2 * n + (i + 1) % n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals();
  d.add('body', g, '#8fae9c', x, 0, z);
  const lip = new THREE.CylinderGeometry(1, 1, 0.12, 18);
  lip.scale(rx * 1.08, 1, rz * 1.05);
  d.add('body', lip, P.sand, x, 0.04, z);
}

/** 两层海湾剪影与一座奶白小灯塔：固定在海侧远景，不随近景成组绕回。 */
export function buildBayHorizon(d: Diorama): void {
  land(d, -27, -78, 9.5, 14, 3.4);
  land(d, -47, -108, 16, 16, 4.3);
  const x = -22.5, z = -71.5;
  d.cyl('body', 1.4, 1.6, 0.28, 12, x, 1.15, z, P.deck);
  d.cyl('body', 0.62, 0.9, 3.7, 10, x, 3.08, z, P.wall);
  d.cyl('body', 0.65, 0.69, 0.42, 10, x, 4.25, z, P.umbrella);
  d.cyl('body', 0.88, 0.88, 0.12, 10, x, 4.93, z, P.wallShade);
  d.cyl('body', 0.53, 0.53, 0.74, 8, x, 5.33, z, P.glass);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    d.strut('body', x + Math.cos(a) * 0.6, 4.97, z + Math.sin(a) * 0.6,
      x + Math.cos(a) * 0.6, 5.76, z + Math.sin(a) * 0.6, 0.045, P.frame, 4);
  }
  d.cyl('body', 0.02, 0.9, 0.64, 10, x, 5.98, z, P.roofDark);
  d.quad('body', 0.32, 0.65, x, 2.08, z + 0.83, P.frame);
}

/** 海外低沙洲，宽缓沙唇 + 一侧礁石。每片独立循环，留出海与本岸之间的蓝水层。 */
export function buildShoal(d: Diorama): void {
  const sand = new THREE.SphereGeometry(1, 14, 4);
  sand.scale(3.5, 0.14, 8.2);
  d.add('body', sand, '#e7d9b5', 0, 0.06, 0);
  const crest = new THREE.SphereGeometry(1, 14, 4);
  crest.scale(2.7, 0.19, 6.5);
  d.add('body', crest, P.sand, -0.3, 0.13, -0.3);
  for (let i = 0; i < 3; i++) {
    d.blob('body', 0.7, 0.35, 1, -1.2, 0.26, -4 + i * 1.1, P.rock, 0);
  }
  // 少量弯白线提示远岸碎浪，不拉成长条平行车道。
  for (let i = 0; i < 3; i++) d.slab('body', 0.1, 2.2, 2.7 + i * 0.08, 0.09, -3 + i * 2.5, P.foam, { ry: -0.12 });
}

/** 双帆只用两块真实三角面，船体/木质舷沿合并；无帆面纹理或阴影贴图。 */
export function buildSailboat(d: Diorama): void {
  d.oval('body', 0.7, 0.35, 2.4, 0, 0.17, 0, P.wall, {});
  d.oval('body', 0.58, 0.12, 2, 0, 0.41, 0, P.wood, {});
  d.strut('body', 0, 0.4, 0, 0, 5.1, 0, 0.045, P.woodDark, 5);
  const sail = (pts: number[], c: string): void => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...pts, ...pts.slice(6, 9), ...pts.slice(3, 6), ...pts.slice(0, 3)], 3));
    // 两面分开法线，仍走原有单面 body 材质。
    g.computeVertexNormals();
    d.add('body', g, c, 0, 0, 0);
  };
  sail([0, 4.95, -0.08, 0, 0.8, -0.08, 0.16, 0.8, -2], P.umbrellaTop);
  sail([0, 4.65, 0.16, 0, 1.1, 0.16, 0.12, 1.1, 1.65], '#f4bd91');
  d.strut('body', 0, 0.77, 0, 0.16, 0.77, -2, 0.025, P.woodDark, 4);
}

/** 海边木构遮阳亭：薄帆布下透出木梁和木板平台，座椅属于亭子内部，不另塞灌木。 */
export function buildShadePavilion(d: Diorama): void {
  for (let i = 0; i < 12; i++) d.box('body', 4.5, 0.12, 0.25, 0, 0.08, -1.6 + i * 0.28, i % 3 ? P.wood : '#dcba8b');
  for (const x of [-2.05, 2.05]) for (const z of [-1.45, 1.45]) {
    d.box('body', 0.13, 2.9, 0.13, x, 1.57, z, P.woodDark);
    d.box('body', 0.21, 0.12, 0.21, x, 0.27, z, P.deck);
  }
  for (const z of [-1.5, 1.5]) d.box('body', 4.7, 0.16, 0.16, 0, 2.86, z, P.woodDark);
  for (let i = 0; i < 7; i++) d.box('body', 0.12, 0.13, 3.3, -2 + i * 0.67, 2.97, 0, P.wood);
  // 张拉布中间轻垂的真实面，侧景可看见帆布与梁的高度差。
  const g = new THREE.PlaneGeometry(4.9, 3.65, 6, 2);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, 3.08 + 0.2 * (p.getX(i) / 2.45) ** 2);
  g.computeVertexNormals();
  d.add('body', g, P.umbrellaTop, 0, 0, 0);
  for (const x of [-1.65, 1.65]) {
    d.box('body', 0.22, 0.045, 3.65, x, 3.23, 0, P.umbrella, { rz: x > 0 ? 0.1 : -0.1 });
  }
  d.box('body', 2.8, 0.14, 0.65, 0, 0.55, -1, P.woodDark);
  d.box('body', 2.65, 0.12, 0.6, 0, 0.66, -1, P.cushion);
  for (const x of [-1, 1]) d.box('body', 0.55, 0.18, 0.48, x, 0.8, -1, P.sofaCool, { rz: x * 0.12 });
  for (const x of [-1.15, 1.15]) d.box('body', 0.12, 0.42, 0.6, x, 0.32, -1, P.wood);
  d.box('body', 0.9, 0.08, 0.6, 0, 0.62, 0.4, P.wood);
  d.box('body', 0.15, 0.44, 0.3, 0, 0.36, 0.4, P.woodDark);
  d.cyl('body', 0.13, 0.1, 0.19, 8, 0.2, 0.75, 0.4, P.umbrella);
}

/** 冲浪者的冲脚台与板架：小型生活设施，外廓小于 2.7×2.4m。 */
export function buildRinseStation(d: Diorama): void {
  for (let i = 0; i < 7; i++) d.box('body', 2.3, 0.1, 0.22, 0, 0.08, -0.72 + i * 0.24, P.wood);
  d.box('body', 0.16, 2.4, 0.16, -0.92, 1.3, -0.5, P.woodDark);
  d.strut('body', -0.92, 2.3, -0.5, -0.3, 2.3, -0.5, 0.035, P.rail, 6);
  d.cyl('body', 0.13, 0.1, 0.04, 8, -0.3, 2.27, -0.5, P.frame);
  d.box('body', 0.3, 0.12, 0.1, -0.92, 0.7, -0.39, P.glass);
  for (const x of [0.3, 0.8]) {
    d.oval('body', 0.24, 1.15, 0.08, x, 1.2, -0.7, x < 0.5 ? P.umbrella : P.sofaCool, { rx: -0.18 });
    d.box('body', 0.04, 1.85, 0.025, x, 1.22, -0.56, P.umbrellaTop, { rx: -0.18 });
  }
  d.box('body', 1.2, 0.09, 0.15, 0.5, 0.7, -0.82, P.woodDark);
}

/** 五道细沙纹只占一个小斑块，几何细线跟沙面起伏，避免满屏均匀噪声。 */
export function buildSandRipples(d: Diorama): void {
  for (let k = 0; k < 5; k++) {
    const points: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const x = -0.62 + i * 0.21, z = (k - 2) * 0.15 + Math.sin(i * 0.7 + k * 0.2) * 0.09;
      points.push(x, 0.07, z, x, 0.07, z + 0.015 + rnd(k, 3) * 0.009);
      if (i < 6) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setIndex(indices); g.computeVertexNormals();
    d.add('body', g, '#dfcc9f', 0, 0, 0);
  }
}
