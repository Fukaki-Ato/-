import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** WX不依赖浏览器贴图注入：远距/未载完模型的补给箱仍有可区分的矢量标志。 */
export const PICKUP_BEACON_COLORS: Readonly<Record<string, number>> = {
  item_magnet: 0xdcc7f1, item_shield: 0xaddfdc, item_jetpack: 0xf3c7a3,
  item_board: 0xc4c5ed, item_multiplier: 0xf3d58d, item_boots: 0xb9debb, item_helmet: 0xf0bcb2,
};

/** 一类一份合并几何，位于箱子+Z正面；中心原点、宽高不超过0.52m。 */
export function createPickupBeaconGeometry(itemRef: string): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const polygon = (points: number[][]): void => {
    const shape = new THREE.Shape(); shape.moveTo(points[0][0], points[0][1]);
    for (const [x,y] of points.slice(1)) shape.lineTo(x,y);
    shape.closePath(); pieces.push(new THREE.ShapeGeometry(shape));
  };
  const line = (x0: number, y0: number, x1: number, y1: number, width = .045): void => {
    const length = Math.hypot(x1-x0,y1-y0);
    const plane = new THREE.PlaneGeometry(length + width, width);
    plane.rotateZ(Math.atan2(y1-y0,x1-x0)); plane.translate((x0+x1)/2,(y0+y1)/2,0);
    pieces.push(plane);
  };
  const disc = (x: number,y: number,r: number): void => {
    const geometry = new THREE.CircleGeometry(r,12); geometry.translate(x,y,0); pieces.push(geometry);
  };
  switch (itemRef) {
    case 'item_magnet':
      polygon([[-.21,.20],[-.105,.20],[-.105,-.06],[-.07,-.12],[.07,-.12],[.105,-.06],[.105,.20],
        [.21,.20],[.21,-.09],[.13,-.22],[-.13,-.22],[-.21,-.09]]); break;
    case 'item_shield':
      polygon([[0,.25],[.22,.16],[.18,-.10],[0,-.25],[-.18,-.10],[-.22,.16]]);
      break;
    case 'item_jetpack':
      for (const x of [-.12,.12]) {
        polygon([[x,.25],[x+.07,.12],[x+.07,-.12],[x-.07,-.12],[x-.07,.12]]);
        polygon([[x-.05,-.16],[x+.05,-.16],[x,-.26]]);
      }
      line(-.08,0,.08,0); break;
    case 'item_board':
      polygon([[-.24,-.04],[-.20,-.10],[.19,.02],[.25,.12],[.18,.16],[-.20,.04]]);
      disc(-.13,-.15,.045); disc(.12,-.07,.045); break;
    case 'item_multiplier':
      line(-.23,-.07,-.08,.08); line(-.23,.08,-.08,-.07);
      // 手画数字2，不依赖字体或运行时canvas。
      line(.02,.17,.16,.17,.05); line(.16,.17,.21,.11,.05);
      line(.21,.11,.20,.04,.05); line(.20,.04,.02,-.14,.05); line(.02,-.14,.22,-.14,.05);
      break;
    case 'item_boots':
      for (const x of [-.16,.09]) {
        polygon([[x-.06,.21],[x+.05,.21],[x+.05,-.06],[x+.12,-.08],[x+.12,-.15],[x-.07,-.15]]);
        line(x-.04,-.22,x+.10,-.22,.025);
      }
      break;
    case 'item_helmet': {
      const curve = new THREE.Shape(); curve.moveTo(-.22,-.06);
      curve.bezierCurveTo(-.23,.29,.23,.29,.22,-.06);
      curve.lineTo(-.22,-.06); pieces.push(new THREE.ShapeGeometry(curve,12));
      line(-.25,-.10,.25,-.10,.055); line(-.14,-.13,-.09,-.23,.028); line(-.09,-.23,.09,-.23,.028);
      break;
    }
    default: line(0,-.18,0,.18); line(-.18,0,.18,0);
  }
  // Plane/Shape geometries all have position, normal and uv, so merging keeps one draw.
  const result = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  result.name = `pickup-beacon:${itemRef}`;
  return result;
}
