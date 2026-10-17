import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

// Execute the real DOM helper without CSS; the fake DOM tests listener ownership, not layout.
const source = readFileSync(new URL('../apps/web/src/mobileUi.ts', import.meta.url), 'utf8')
  .replace(/^import ['"][^'"]+\.css['"];\s*/gm, '');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { pageLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('mobile page owns Escape listener, removes it, and restores connected focus', t => {
  const descriptors = ['document', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  class Element extends EventTarget {
    isConnected = true;
    focusCount = 0;
    focus() { this.focusCount++; }
    remove() { this.isConnected = false; }
  }
  const previous = new Element();
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Element });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: previous } });
  const root = new Element();
  let backs = 0;
  const dispose = pageLifecycle(root, () => { backs++; });
  assert.equal(root.tabIndex, -1);
  assert.equal(root.focusCount, 1);
  const key = name => Object.assign(new Event('keydown', { cancelable: true }), { key: name });
  root.dispatchEvent(key('Enter'));
  assert.equal(backs, 0);
  const escape = key('Escape');
  root.dispatchEvent(escape);
  assert.equal(backs, 1);
  assert.equal(escape.defaultPrevented, true);
  dispose();
  assert.equal(root.isConnected, false);
  assert.equal(previous.focusCount, 1);
  root.dispatchEvent(key('Escape'));
  assert.equal(backs, 1, 'disposed page no longer handles Escape');

  previous.isConnected = false;
  const another = new Element();
  const disposeAnother = pageLifecycle(another);
  const unusedEscape = key('Escape');
  another.dispatchEvent(unusedEscape);
  assert.equal(unusedEscape.defaultPrevented, false);
  disposeAnother();
  assert.equal(previous.focusCount, 1, 'detached previous element is not focused');
});
