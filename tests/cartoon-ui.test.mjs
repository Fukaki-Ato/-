import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../apps/web/src/mobileLobby.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  loader: { '.css': 'empty' },
  plugins: [{ name: 'test-art-paths', setup(builder) {
    builder.onResolve({ filter: /\.(webp|png)$/ }, args => ({ path: args.path, namespace: 'art' }));
    builder.onLoad({ filter: /.*/, namespace: 'art' }, args => ({ contents: `export default ${JSON.stringify(args.path)}`, loader: 'js' }));
  } }],
});
const { createMobileLobby } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

function fixture(t) {
  const keys = ['document', 'window', 'HTMLElement'];
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag; this.children = []; this.attributes = new Map(); this.className = ''; this._text = '';
      this.style = { setProperty() {} };
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
      };
    }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    focus() { document.activeElement = this; }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    get isConnected() { return !this.removed; }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const body = new Element('body');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body, activeElement: body, createElement: tag => new Element(tag) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 1, clearTimeout() {} } });
  const content = Object.fromEntries(['game','characters','skills','items','economy','events','themes','obstacles'].map(name => [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
  const all = root => [root, ...root.children.flatMap(all)];
  const byClass = (root, name) => all(root).filter(node => node.className.split(' ').includes(name));
  return { body, content, all, byClass };
}

test('illustrated lobby keeps side shortcuts accessible and native labels separate from art', t => {
  const { body, content, all, byClass } = fixture(t);
  const calls = [];
  const dispose = createMobileLobby(content, {
    onStartRun: id => calls.push(id), onChooseCharacter: () => true, onBack() {},
    onShop: () => calls.push('shop'), onSettings: () => calls.push('settings'), onCharacterSelect: () => calls.push('characters'),
  }, 'char_volt', { coins: 123, diamonds: 4 });
  const root = body.children[0];
  const hero = byClass(root, 'lobby-hero')[0];
  assert.notEqual(hero.getAttribute('aria-hidden'), 'true', 'interactive side nav must not live under aria-hidden');
  const shortcuts = byClass(hero, 'lobby-shortcut');
  assert.deepEqual(shortcuts.map(button => button.textContent), ['活动','任务','成就','排行榜']);
  assert.ok(shortcuts.every(button => button.children[0].tagName === 'img' && button.children[0].src.endsWith('.webp')));
  assert.ok(shortcuts.every(button => button.children[1].tagName === 'span'), 'labels are live text, not baked controls');
  assert.equal(byClass(root, 'shortcut-symbol').length, 0, 'generic text symbols were replaced by old illustrated art');
  shortcuts[0].click();
  assert.match(byClass(root, 'lobby-toast')[0].textContent, /准备中/);
  all(root).find(node => node.getAttribute('aria-label') === '设置').click();
  byClass(root, 'lobby-runner')[0].click();
  byClass(root, 'lobby-start')[0].click();
  byClass(root, 'lobby-nav-button').find(button => button.textContent === '商店').click();
  assert.deepEqual(calls, ['settings','characters','char_volt','shop']);
  dispose();
  assert.equal(body.children.length, 0);
});

test('restyled lobby still rejects a locked current role and starts only an available fallback', t => {
  const { body, content, byClass } = fixture(t);
  content.characters.items.find(item => item.id === 'char_ama').locked = true;
  let started = '';
  const dispose = createMobileLobby(content, { onStartRun: id => { started = id; }, onChooseCharacter: () => true, onBack() {} }, 'char_ama');
  byClass(body, 'lobby-start')[0].click();
  assert.equal(started, 'char_volt');
  dispose();
});
