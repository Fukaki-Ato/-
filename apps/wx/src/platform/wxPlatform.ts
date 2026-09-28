/**
 * createWxAdapter —— PlatformAdapter v2 的微信小游戏实现总装（S10 §4/§5）。
 * 各能力拆在同目录模块（垫片/画布/输入/存储/网络/extras），本文件只做装配与
 * 三个「逐字同 v1」成员的 wx 映射：requestFrame/cancelFrame/onVisibility/now。
 * 时间基准（D12）：now() 优先 wx.getPerformance().now()，缺失退化 Date.now()；
 * requestFrame 回调**不吃原生 timeMs**（K12 不保证），统一回填 now() 保证与 now() 同基准
 * ——runnerScene 的固定步长循环用 now() 与帧时间戳混算，基准漂移会直接表现为 dt 尖峰。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { createWxCanvasFactory } from './canvasFactory.js';
import { createWxInput } from './input.js';
import { createWxStorage } from './storage.js';
import { wxFetchJson } from './network.js';
import { createWxExtras } from './extras.js';
import { getWx, type WxLike } from './wxTypes.js';

export interface WxAdapterOptions {
  /** 注入运行时（默认真实全局 wx；node:test 传 mock） */
  wx?: WxLike;
}

export function createWxAdapter(options: WxAdapterOptions = {}): PlatformAdapter {
  const wx = options.wx ?? getWx();

  const now = (): number => {
    if (typeof wx.getPerformance === 'function') {
      try {
        return wx.getPerformance().now();
      } catch {
        /* 基础库不支持 → 退化 */
      }
    }
    return Date.now(); // 退化路径（S10 §4 允许，汇报注明）
  };

  const storage = createWxStorage(wx);
  const input = createWxInput(wx, now);

  return {
    version: 2,
    env: 'wx',
    canvas: createWxCanvasFactory(wx),
    onInput: cb => input.onInput(cb),
    storage,
    fetchJson: url => wxFetchJson(wx, url),

    requestFrame: cb => wx.requestAnimationFrame(() => cb(now())), // 忽略原生入参（K12/D12）
    cancelFrame: handle => wx.cancelAnimationFrame(handle),

    onVisibility(cb) {
      const show = () => cb(false);
      const hide = () => {
        input.reset(); // 进后台打断触点序列（S10 §6：cancel/页面隐藏清态）
        cb(true);
      };
      wx.onShow(show);
      wx.onHide(hide);
      return () => {
        wx.offShow(show);
        wx.offHide(hide);
      };
    },

    now,
    extras: createWxExtras(wx, storage),
  };
}
