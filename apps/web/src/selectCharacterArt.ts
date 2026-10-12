import { applyCharacterArt, getCharacterArt, type CharacterArtInput } from './characterArt.js';
import ama from './assets/character-select/portraits/ama.webp';
import kaze from './assets/character-select/portraits/kaze.webp';
import rina from './assets/character-select/portraits/rina.webp';
import bolt from './assets/character-select/portraits/bolt.webp';
import frog from './assets/character-select/portraits/frog.webp';
import mambo from './assets/character-select/portraits/mambo.webp';
import bball from './assets/character-select/portraits/bball.webp';
import whale from './assets/character-select/portraits/whale.webp';
import niu from './assets/character-select/portraits/niu.webp';

const PORTRAITS: Record<string, string> = {
  char_volt: bball, char_ama: ama, char_kaze: kaze, char_rina: rina, char_bolt: bolt,
  char_frog: frog, char_mambo: mambo, char_whale: whale, char_niu: niu,
};

/** Selection-only presentation; the approved lobby artwork remains unchanged. */
export function applySelectArt(el: HTMLElement, input: CharacterArtInput): void {
  const url = PORTRAITS[input.charId];
  el.style.setProperty('--char-tint', input.tint);
  el.classList.toggle('is-select-cutout', Boolean(url));
  if (!url) { applyCharacterArt(el, getCharacterArt(input)); return; }
  el.classList.remove('is-sheet-art', 'is-generic-art');
  el.style.backgroundImage = '';
  const image = document.createElement('img');
  image.src = url;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  image.loading = el.classList.contains('select-card-art') ? 'lazy' : 'eager';
  el.replaceChildren(image);
}

export function createSelectPortrait(input: CharacterArtInput, className: string): HTMLDivElement {
  const portrait = document.createElement('div');
  portrait.className = className;
  portrait.setAttribute('aria-hidden', 'true');
  applySelectArt(portrait, input);
  return portrait;
}
