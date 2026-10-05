/**
 * 微信小游戏全局 API 类型（仅类型，不产出任何运行时代码）。
 *
 * - 使用官方 `miniprogram-api-typings`（devDependency）提供全局 `wx` 声明；
 * - 业务代码不直接引用全局 `wx`：运行时探测点唯一收敛在
 *   `assets/scripts/ui/platform/wechat/WechatTypes.ts`，其余代码面向 `IPlatformAdapter`；
 * - 本文件同时做编译期子集校验：官方 `WechatMiniprogram.Wx` 必须满足我们手写的
 *   最小 `WxApi` 接口，官方类型升级导致签名漂移时会在此报错。
 */
/// <reference types="miniprogram-api-typings" />

import type { WxApi } from '../assets/scripts/ui/platform/wechat/WechatTypes';

type Assert<T extends true> = T;

type _WxApiSubsetCheck = Assert<WechatMiniprogram.Wx extends WxApi ? true : false>;
