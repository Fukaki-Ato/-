import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL(`../apps/web/src/${name}`, import.meta.url), 'utf8');

test('coastal frame redraw keeps the original scenery instead of replacement backgrounds', () => {
  const lobby = source('mobileLobby.css');
  assert.match(lobby, /url\('\.\/assets\/mobile-ui\/seaside\.webp'\)/);
  for (const name of ['mobileLobby.css', 'coastalSkins.css', 'coastalFrames.css']) {
    assert.doesNotMatch(source(name), /coastal-bay\.webp|coastal-pattern\.svg/);
  }
});

test('nine-slice coastal frame has fixed intrinsic dimensions and contains no baked labels', () => {
  const frame = source('assets/mobile-ui/coastal-frame.svg');
  assert.match(frame, /width="180" height="180" viewBox="0 0 180 180"/);
  for (const name of ['frame', 'shell', 'corner', 'wave']) {
    assert.doesNotMatch(source(`assets/mobile-ui/coastal-${name}.svg`), /<text\b|<foreignObject\b/);
  }
});
