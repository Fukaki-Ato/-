/** WX PlatformAdapter implementation and the only package allowed to access the WX global. */
export { createWxAdapter } from './wxPlatform.js';
export type { WxAdapterOptions } from './wxPlatform.js';
export { installCanvasShim, getContext } from './shim.js';
export type { CanvasShimHandle } from './shim.js';
export { getWx } from './wxTypes.js';
export type { WxLike, WxRawCanvas, WxTouchEvent, WxTouch } from './wxTypes.js';
export { createWxStorage } from './storage.js';
export { createWxAudio } from './audio.js';
export type { WxInnerAudioContext } from './wxTypes.js';
export { wxFetchJson, wxReadJson, wxReadBinary } from './network.js';
export { createWxExtras } from './extras.js';
export { createWxCanvasFactory } from './canvasFactory.js';
export { createWxInput } from './input.js';
