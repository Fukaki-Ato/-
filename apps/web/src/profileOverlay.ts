/**
 * 玩家档案 DOM 弹层（Web 壳）：大头像 + 10 枚候选头像（点击即换）、账号 ID、最高记录、
 * 点候选名改名（免费次数用完后扣钻石，余额保存后由返回的大厅重新读取）。
 * 数据全走 core/profile/playerProfile（与 canvas 版 buildProfileOverlay 同一份数据逻辑）；
 * 入口位于设置页「玩家档案」，bootstrap 装配；关闭后回到设置页。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import { AVATAR_KEYS } from '@tr/game/ui/profileView.js';
import { loadProfile, profileParamsFrom, saveProfile, tryRename } from '@tr/game/core/profile/playerProfile.js';
import { DIAMOND_KEY, walletBalance } from '@tr/game/flow/localEconomy.js';
import { pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './profileOverlay.css';

const BEST_KEY = 'thunderrun:best';
const readCount = (storage: SyncStorage, key: string): number => {
  const n = Number(storage.get(key) ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function openProfileOverlay(
  content: GameContent, storage: SyncStorage, onDiamonds?: (left: number) => void,
): () => void {
  const params = profileParamsFrom((content.game.params as Record<string, unknown>)['profile']);
  let prof = loadProfile(storage, params);
  const avatarUrl = (key: string): string => `${import.meta.env.BASE_URL}assets/ui/badges/normal/${key}.png`;

  const root = uiText('section', '', 'tr-profile-overlay');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '玩家档案');
  const panel = uiText('div', '', 'profile-panel ui-panel');

  const head = uiText('header', '', 'profile-head');
  head.append(uiText('h2', '玩家档案'));
  const disposeBox: { dispose?: () => void } = {};
  const dismiss = (): void => { disposeBox.dispose?.(); };
  const close = uiButton('×', 'profile-close', dismiss);
  close.setAttribute('aria-label', '关闭档案');
  head.append(close);
  panel.append(head);

  const big = document.createElement('img');
  big.className = 'profile-avatar-big';
  big.alt = '当前头像';
  const paint = (): void => { big.src = avatarUrl(AVATAR_KEYS[prof.avatar] ?? AVATAR_KEYS[0]!); };
  const nameL = uiText('strong', prof.name, 'profile-name');
  const idL = uiText('p', `账号 ID：${prof.id}`, 'profile-id');
  const bestL = uiText('p', `最高记录：${readCount(storage, BEST_KEY)} 米`, 'profile-best');
  const hintL = uiText('p', '', 'profile-hint');
  const hint = (): string => {
    const freeLeft = Math.max(0, params.freeRenames - prof.renames);
    return freeLeft > 0
      ? `点候选名字改一个 · 免费 ${freeLeft} 次`
      : `点候选名字改一个 · 每次 ${params.renameCostDiamonds} 钻（余额 ${walletBalance(storage, 'diamond')}）`;
  };
  hintL.textContent = hint();

  const pickers = uiText('div', '', 'profile-avatars');
  pickers.setAttribute('aria-label', '候选头像');
  AVATAR_KEYS.forEach((key, i) => {
    const b = uiButton('', 'profile-avatar-pick', () => {
      if (i === prof.avatar) return;
      prof = { ...prof, avatar: i };
      saveProfile(storage, prof);
      paint();
    });
    b.setAttribute('aria-label', `选择头像 ${i + 1}`);
    const img = document.createElement('img');
    img.src = avatarUrl(key);
    img.alt = '';
    b.append(img);
    pickers.append(b);
  });

  const names = uiText('div', '', 'profile-names');
  names.setAttribute('aria-label', '候选昵称');
  for (const candidate of params.nameCandidates) {
    names.append(uiButton(candidate, 'profile-name-pick', () => {
      const r = tryRename(prof, params, candidate, walletBalance(storage, 'diamond'));
      if (!r.ok) {
        hintL.textContent = r.reason === 'need-diamonds'
          ? `改名需要 ${r.cost} 钻石，钻石不足`
          : r.reason === 'same' ? '已经是这个名字了' : '名字不合规，换一个';
        return;
      }
      prof = r.profile;
      saveProfile(storage, prof);
      storage.set(DIAMOND_KEY, String(r.diamondsLeft));
      nameL.textContent = prof.name;
      hintL.textContent = hint();
      onDiamonds?.(r.diamondsLeft);
    }));
  }

  panel.append(big, nameL, idL, bestL, hintL, pickers, names, buildInventory(content, storage));

  function buildInventory(c: GameContent, s: SyncStorage): HTMLElement {
    // 仓库 MVP（审查 M4-6）：档案内直接列钱包库存——货币 + 碎片 + 持有道具；正式独立页待元游戏扩展
    const box = uiText('div', '', 'profile-inventory');
    box.setAttribute('aria-label', '背包');
    box.append(uiText('h3', '背包', 'profile-inventory-title'));
    const row = (label: string, n: number): void => {
      const el = uiText('div', '', 'profile-inventory-row');
      el.append(uiText('span', label), uiText('strong', String(n)));
      box.append(el);
    };
    row('金币', walletBalance(s, 'coin'));
    row('钥匙', walletBalance(s, 'key'));
    row('钻石', walletBalance(s, 'diamond'));
    for (const shard of ((c.economy.params?.shards ?? []) as { id?: unknown }[])) {
      if (typeof shard.id !== 'string') continue;
      row(shard.id, walletBalance(s, shard.id));
    }
    for (const item of ((c.items?.items ?? []) as { id?: unknown }[])) {
      if (typeof item.id !== 'string' || !item.id.startsWith('item_')) continue;
      const n = walletBalance(s, item.id);
      if (n > 0) row(item.id, n);
    }
    return box;
  }
  root.append(panel);
  root.addEventListener('click', e => { if (e.target === root) dismiss(); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  document.body.append(root);
  disposeBox.dispose = pageLifecycle(root, dismiss);
  paint();
  return () => disposeBox.dispose?.();
}
