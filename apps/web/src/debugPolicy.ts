import { debugQueryFlags } from '@tr/game/core/debugMode.js';

/** Official production builds never enable QA from a URL alone. Private QA builds opt in explicitly. */
export const DEBUG_TOOLS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_TR_ALLOW_DEBUG === '1';
export function runtimeDebugFlags(search: string, enabled = DEBUG_TOOLS_ENABLED) {
  const flags = debugQueryFlags(search);
  return enabled ? flags : { debug: false, test: false, qa: false };
}
export function runtimeDebugParams(search: string, enabled = DEBUG_TOOLS_ENABLED): URLSearchParams | undefined {
  if (!enabled) return undefined;
  const result = new URLSearchParams();
  new URLSearchParams(search).forEach((value, key) => {
    result.append(['debug', 'test', 'anim', 'ui'].includes(key.toLowerCase()) ? key.toLowerCase() : key, value);
  });
  return result;
}
