/**
 * 熔炉巨兽潮汐纯函数 —— re-export sim 层单源（M4 Phase B-1：core/sim/tide.ts 是唯一权威实现，
 * 本文件只是渲染层的路径别名；forgeheart 各模块的既有 import 无需改动）。
 */
export { level, surgeWindow, surgeStart } from '@tr/game/core/sim/tide.js';
