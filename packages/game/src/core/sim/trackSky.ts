/**
 * 空中内容铺设（飞行段金币带与云团）——trackGen 专用纯函数，独立成文件守 300 行上限。
 * 用户反馈修正：空中金币不再「每条链都铺满三条道」，改为与地面同款 laneGroupWeights
 * （1 道 70% / 2 道 25% / 3 道 5%）抽本组车道数；同组同链、组间留空档。
 */
import type { RunRng } from '../rng.js';
import type { CloudEntity, CoinEntity } from './trackGen.js';

export interface SkyLayDeps {
  rng: RunRng;
  chainBuckets: { min: number; max: number; weight: number }[];
  spacing: number;
  laneWeights: Record<number, number>;
  laneWidth: number;
  fromZ: number; toZ: number; skyY: number;
  coins: CoinEntity[];
  clouds: CloudEntity[];
  /** 链号发牌器（保持 sim 内 chain 序号唯一，整链撤回用） */
  seq(): number;
}

export function spawnSkyContent(d: SkyLayDeps): void {
  const spacing = d.spacing * 0.65; // 空中金币带：间距再收紧、链间空档缩短（"金币会变多"）
  let z = d.fromZ + 8 + d.rng.range(0, 10);
  while (z < d.toZ - 8) {
    const laneCount = d.rng.weighted([1, 2, 3], k => d.laneWeights[k] ?? 0);
    const lanes = [-1, 0, 1];
    d.rng.shuffle(lanes);
    const bucket = d.rng.weighted(d.chainBuckets, b => b.weight);
    const len = d.rng.int(bucket.min, bucket.max);
    const id = d.seq();
    for (const lane of lanes.slice(0, laneCount)) {
      for (let i = 0; i < len; i++) {
        const cz = z + i * spacing;
        if (cz < d.toZ - 4) d.coins.push({ lane, worldZ: cz, y: d.skyY, chain: id });
      }
    }
    z += len * spacing + d.rng.range(10, 18); // 组间留空档，密度可控
  }
  for (let cz = d.fromZ + 12; cz < d.toZ - 6; cz += d.rng.range(30, 46)) {
    d.clouds.push({
      worldZ: cz,
      x: d.rng.pick([-1, 0, 1]) * d.laneWidth + d.rng.range(-0.6, 0.6),
      y: d.rng.range(d.skyY - 0.5, d.skyY + 0.9),
    });
  }
}
