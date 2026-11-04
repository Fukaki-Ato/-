import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_VOLUME_KEY, SFX_VOLUME_KEY, storedVolume, volumePrefs, pruneVolumePrefs,
} from '../packages/game/dist/flow/settingsScene.js';

const fixture = raw => {
  const values = new Map([[MUSIC_VOLUME_KEY, raw], [SFX_VOLUME_KEY, '0']]);
  return { values, storage: { get: key => values.get(key) ?? null, remove: key => values.delete(key) } };
};

test('volume preferences reject noncanonical percent strings instead of silently muting', () => {
  for (const raw of ['', ' ', '\t', '0x32', '1e2', '50.0', '01', '+50', '-0', '101', '-1', 'NaN']) {
    const { values, storage } = fixture(raw);
    assert.equal(storedVolume(storage, 'music'), null, JSON.stringify(raw));
    assert.deepEqual(volumePrefs(storage, null), { music: 0.7, sfx: 0 });
    pruneVolumePrefs(storage);
    assert.equal(values.has(MUSIC_VOLUME_KEY), false, JSON.stringify(raw));
    assert.equal(values.get(SFX_VOLUME_KEY), '0', 'valid mute preference survives cleanup');
  }
});

test('volume preferences retain every valid integer percent including both endpoints', () => {
  for (let percent = 0; percent <= 100; percent++) {
    const { values, storage } = fixture(String(percent));
    assert.equal(storedVolume(storage, 'music'), percent / 100);
    pruneVolumePrefs(storage);
    assert.equal(values.get(MUSIC_VOLUME_KEY), String(percent));
  }
});
