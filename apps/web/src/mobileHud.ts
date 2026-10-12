import type { HudHandle } from '@tr/game/flow/views.js';
import { uiText } from './mobileUi.js';
import './mobileHud.css';

export function createMobileHud(): HudHandle {
  const root = uiText('section', '', 'mobile-hud');
  root.setAttribute('aria-label', '跑酷状态');
  const top = uiText('div', '', 'hud-top');
  const scoreCard = uiText('div', '', 'hud-score-card');
  const score = uiText('strong', '0', 'hud-score');
  const distance = uiText('span', '0 m', 'hud-distance');
  scoreCard.append(uiText('span', 'SCORE', 'hud-label'), score, distance);
  const counters = uiText('div', '', 'hud-counters');
  const coins = uiText('span', '0', 'hud-coins');
  const coin = document.createElement('img');
  coin.src = `${import.meta.env.BASE_URL}assets/ui/icon_gold.png`;
  coin.alt = '';
  coins.prepend(coin);
  const coinValue = uiText('strong', '0');
  coins.replaceChildren(coin, coinValue);
  const hearts = uiText('span', '', 'hud-hearts');
  counters.append(coins, hearts);
  top.append(scoreCard, counters);
  const buffs = uiText('div', '', 'hud-buffs');
  const skill = uiText('div', '', 'hud-skill');
  const skillName = uiText('strong', '');
  const skillState = uiText('span', '');
  skill.append(uiText('span', 'ϟ', 'hud-skill-icon'), skillName, skillState);
  root.append(top, buffs, skill);
  document.body.append(root);
  let disposed = false;
  return {
    update(h) {
      if (disposed) return;
      score.textContent = h.score.toLocaleString();
      distance.textContent = `${Math.floor(h.distance)} m`;
      coinValue.textContent = h.coins.toLocaleString();
      const lives = Math.max(0, h.lives ?? 1);
      const hits = Math.max(0, Math.min(h.hits, lives));
      hearts.textContent = '♥'.repeat(lives - hits) + '♡'.repeat(hits);
      hearts.setAttribute('aria-label', `剩余生命 ${lives - hits}`);
      const merged = new Map<string, number>();
      for (const buff of h.buffs ?? []) merged.set(buff.name, Math.max(merged.get(buff.name) ?? -Infinity, buff.left));
      buffs.textContent = [...merged].map(([name, left]) => `${name}${Number.isFinite(left) ? ` ${Math.ceil(left)}s` : ''}`).join(' · ');
      buffs.hidden = !buffs.textContent;
      const sk = h.skill;
      skill.hidden = !sk;
      if (!sk) return;
      skillName.textContent = sk.label;
      skill.classList.toggle('is-ready', sk.ready);
      skillState.textContent = sk.cd > 0 ? `${sk.cd.toFixed(1)}s` : sk.ready ? '双击释放 / E' : sk.charge ? `下滑 ${sk.charge.now}/${sk.charge.need}` : '准备中';
    },
    dispose() { if (disposed) return; disposed = true; root.remove(); },
  };
}
