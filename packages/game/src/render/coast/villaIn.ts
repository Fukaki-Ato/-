/**
 * 白日海景 · 别墅室内（两层，全部走 glow 自发光桶）。
 * 走 glow 而不是受光有两个理由：① 大落地玻璃后面要「一眼看穿、明亮饱满」，
 * 受光桶会被白天的主光打出大片阴影，室内就糊成一团黑；② 自发光颜色可以直接按
 * 动画色板取（奶白/暖木/橘粉沙发），透玻璃出来干净通透，不依赖灯光调参。
 * 清单按需求给全：布艺沙发、简约茶几、落地台灯、吊顶暖光灯带、墙面挂画、
 * 窗边榻榻米、小书柜、落地窗帘（在 villa.ts）、整洁地板、居家摆件。
 */
import { P, R90 } from './palette.js';
import { V } from './villa.js';
import { rnd, type Diorama } from '../konbini/kit.js';

const IX0 = V.x0 + 0.12, IX1 = V.x1 - 0.12, IZ0 = V.z0 + 0.12, IZ1 = V.z1 - 0.12;
const CX = (V.x0 + V.x1) / 2;

export function buildVillaInterior(d: Diorama): void {
  // ================= 一层：客厅 =================
  d.slab('glow', IX1 - IX0, IZ1 - IZ0, CX, 0.06, (IZ0 + IZ1) / 2, P.floor);   // 整洁地板
  d.slab('glow', 2.4, 1.5, CX - 0.4, 0.09, -0.6, P.rug);                      // 地毯
  d.quad('glow', IX1 - IX0 - 0.2, 2.4, CX, 1.4, IZ0 + 0.04, '#fff6e8');       // 北墙内面（室内背景）
  d.quad('glow', IZ1 - IZ0 - 0.4, 2.4, IX0 + 0.04, 1.4, (IZ0 + IZ1) / 2, '#fdeee0', { ry: R90 });
  for (const z of [-2.6, -1.2]) d.slab('glow', 3.6, 0.34, CX, 2.52, z, P.strip);   // 吊顶暖光灯带

  // 布艺沙发（正对玻璃，跑者第一眼看到的就是它）
  const sx = CX - 0.5, sz = -1.9;
  d.box('glow', 2.2, 0.36, 0.86, sx, 0.28, sz, P.sofa);
  d.box('glow', 2.2, 0.66, 0.2, sx, 0.62, sz - 0.36, P.sofa);
  for (const s of [-1, 1]) d.box('glow', 0.22, 0.5, 0.86, sx + s * 1.1, 0.44, sz, P.sofa);
  for (let i = 0; i < 3; i++) d.box('glow', 0.6, 0.14, 0.7, sx - 0.65 + i * 0.65, 0.53, sz + 0.04, P.cushion);
  d.box('glow', 0.34, 0.32, 0.14, sx - 0.72, 0.72, sz - 0.2, P.sofaCool, { rz: 0.3 });
  d.box('glow', 0.34, 0.32, 0.14, sx + 0.7, 0.72, sz - 0.2, P.flower, { rz: -0.25 });

  // 简约茶几：桌面 + 四细腿 + 一只花瓶两本书
  d.box('glow', 1.1, 0.07, 0.6, sx, 0.42, sz + 0.95, P.table);
  for (const [ox, oz] of [[-0.48, -0.22], [0.48, -0.22], [-0.48, 0.22], [0.48, 0.22]] as const) {
    d.box('glow', 0.05, 0.36, 0.05, sx + ox, 0.22, sz + 0.95 + oz, P.woodDark);
  }
  d.cyl('glow', 0.06, 0.09, 0.2, 8, sx - 0.24, 0.56, sz + 0.95, P.glass);
  d.blob('glow', 0.1, 0.12, 0.1, sx - 0.24, 0.72, sz + 0.95, P.flower, 0);
  d.box('glow', 0.26, 0.05, 0.2, sx + 0.22, 0.48, sz + 0.95, P.book[0]);
  d.box('glow', 0.24, 0.04, 0.18, sx + 0.22, 0.52, sz + 0.95, P.book[2], { ry: 0.2 });

  // 落地台灯（暖光罩）+ 一把单人椅
  d.cyl('glow', 0.03, 0.05, 1.3, 6, IX1 - 0.4, 0.72, -2.4, P.beam);
  d.cyl('glow', 0.19, 0.26, 0.3, 10, IX1 - 0.4, 1.48, -2.4, P.lampWarm);
  d.box('glow', 0.5, 0.12, 0.5, IX1 - 0.55, 0.42, -0.9, P.sofaCool);
  d.box('glow', 0.5, 0.5, 0.1, IX1 - 0.55, 0.68, -1.12, P.sofaCool);

  // 小书柜（北墙）+ 彩色书脊
  const bx = IX0 + 0.6;
  d.box('glow', 1.0, 1.6, 0.34, bx, 0.86, IZ0 + 0.24, P.table);
  for (let k = 0; k < 3; k++) {
    d.slab('glow', 0.94, 0.3, bx, 0.44 + k * 0.46, IZ0 + 0.24, P.woodDark);
    for (let i = 0; i < 5; i++) {
      const h = 0.2 + rnd(k * 5 + i, 3) * 0.12;
      d.box('glow', 0.1, h, 0.2, bx - 0.36 + i * 0.18, 0.44 + k * 0.46 + h / 2 + 0.02, IZ0 + 0.24, P.book[(k + i) % 5]);
    }
  }

  // 墙面挂画（北墙两幅、西墙一幅）+ 一只挂钟
  for (let i = 0; i < 2; i++) {
    d.quad('glow', 0.62, 0.46, CX - 1.3 + i * 2.1, 1.9, IZ0 + 0.06, P.art[i % 3]);
    d.box('glow', 0.7, 0.54, 0.03, CX - 1.3 + i * 2.1, 1.9, IZ0 + 0.04, P.beam);
  }
  d.cyl('glow', 0.14, 0.14, 0.04, 12, IX0 + 0.06, 1.9, 0.6, P.beam, { rz: R90 });

  // 绿植 + 地垫 + 小摆件（把角落填满，别留空地板）
  d.cyl('glow', 0.16, 0.13, 0.26, 8, CX + 1.9, 0.19, -2.9, P.pot);
  d.blob('glow', 0.26, 0.34, 0.26, CX + 1.9, 0.56, -2.9, P.plant, 1);
  d.blob('glow', 0.18, 0.2, 0.18, CX + 2.1, 0.82, -2.7, P.plant, 0);
  for (let i = 0; i < 3; i++) d.box('glow', 0.3, 0.06, 0.3, CX + 0.6 + i * 0.4, 0.12, 0.2, P.cushion);

  // ================= 二层：卧室 + 窗边榻榻米 =================
  const uy = V.gf + 0.24;
  d.slab('glow', IX1 - IX0, IZ1 - IZ0, CX, uy + 0.02, (IZ0 + IZ1) / 2, P.floor);
  d.quad('glow', IX1 - IX0 - 0.2, 1.9, CX, uy + 1.1, IZ0 + 0.04, '#fff2e4');
  for (const z of [-2.7, -1.0]) d.slab('glow', 3.4, 0.3, CX, V.uf - 0.24, z, P.strip);

  d.box('glow', 1.9, 0.24, 1.0, CX - 0.6, uy + 0.2, IZ1 - 0.7, P.table);      // 窗边榻榻米
  d.box('glow', 1.78, 0.14, 0.9, CX - 0.6, uy + 0.38, IZ1 - 0.7, P.cushion);
  d.box('glow', 0.4, 0.16, 0.34, CX - 1.3, uy + 0.5, IZ1 - 0.8, P.sofaCool, { rz: 0.2 });
  d.box('glow', 0.4, 0.16, 0.34, CX - 0.8, uy + 0.5, IZ1 - 0.8, P.flower, { rz: -0.15 });
  d.box('glow', 0.5, 0.28, 0.36, CX - 0.1, uy + 0.5, IZ1 - 0.66, P.rug);      // 叠好的软被

  d.box('glow', 1.3, 0.06, 0.55, IX1 - 0.6, uy + 0.66, -2.5, P.table);        // 书桌 + 一把椅
  for (const ox of [-0.58, 0.58]) d.box('glow', 0.05, 0.62, 0.5, IX1 - 0.6 + ox, uy + 0.34, -2.5, P.woodDark);
  d.box('glow', 0.24, 0.3, 0.16, IX1 - 0.9, uy + 0.84, -2.5, P.lampWarm);
  d.box('glow', 0.42, 0.06, 0.42, IX1 - 0.6, uy + 0.3, -1.75, P.sofa);
  d.box('glow', 0.42, 0.46, 0.06, IX1 - 0.6, uy + 0.55, -1.55, P.sofa);

  d.box('glow', 0.9, 1.3, 0.3, CX + 0.6, uy + 0.72, IZ0 + 0.22, P.table);      // 二层小柜 + 摆件
  d.blob('glow', 0.14, 0.16, 0.14, CX + 0.3, uy + 1.46, IZ0 + 0.22, P.glass, 0);
  d.blob('glow', 0.12, 0.18, 0.12, CX + 0.8, uy + 1.48, IZ0 + 0.22, P.flower2, 0);
  d.quad('glow', 0.56, 0.42, CX - 1.6, uy + 1.3, IZ0 + 0.06, P.art[2]);
  d.cyl('glow', 0.14, 0.11, 0.24, 8, IX0 + 0.4, uy + 0.18, -0.4, P.pot);      // 二层绿植
  d.blob('glow', 0.22, 0.3, 0.22, IX0 + 0.4, uy + 0.5, -0.4, P.plant, 0);
}
