import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export async function importWebModule(relative) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
    define: { 'import.meta.env.BASE_URL': '"/"' }, loader: { '.css': 'empty' },
    plugins: [{ name: 'test-art-paths', setup(builder) {
      builder.onResolve({ filter: /\.(webp|png)$/ }, args => ({ path: args.path, namespace: 'art' }));
      builder.onLoad({ filter: /.*/, namespace: 'art' }, args => ({ contents: `export default ${JSON.stringify(args.path)}`, loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

export function fakeDom(t) {
  const originals = ['document','window','HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const all = root => [root, ...root.children.flatMap(all)];
  const byClass = (root, name) => all(root).filter(node => node.className.split(' ').includes(name));
  class Element extends EventTarget {
    constructor(tag) {
      super(); this.tagName = tag; this.children = []; this.attributes = new Map(); this.className = ''; this._text = ''; this.dataset = {};
      this.style = { setProperty() {} }; this.clientWidth = 330; this.offsetWidth = 76; this.scrollLeft = 0;
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
        contains: name => this.className.split(' ').includes(name),
      };
    }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    focus() { document.activeElement = this; }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    get isConnected() { return !this.removed; }
    get offsetLeft() { return Math.max(0, this.parent?.children.indexOf(this) ?? 0) * 84; }
    getClientRects() { for (let node = this; node; node = node.parent) if (node.removed || node.hidden || node.inert) return []; return [{}]; }
    scrollTo(options) { this.scrollLeft = Math.max(0, options.left); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
    querySelectorAll(selector) {
      if (selector.includes('button:not')) return all(this).filter(node => node.tagName === 'button' && !node.disabled);
      if (selector.startsWith('.')) return byClass(this, selector.slice(1));
      return [];
    }
  }
  const body = new Element('body');
  const doc = Object.assign(new EventTarget(), { body, activeElement: body, createElement: tag => new Element(tag), querySelector: () => null });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({matches:true}), setTimeout: () => 1, clearTimeout() {} } });
  const content = Object.fromEntries(['game','characters','skills','items','economy','events','themes','obstacles'].map(name => [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
  const key = value => Object.assign(new Event('keydown', {cancelable:true}), {key:value});
  return { body, content, all, byClass, key };
}
