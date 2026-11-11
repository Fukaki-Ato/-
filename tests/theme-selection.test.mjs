import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { themeOptions } from '../packages/game/dist/ui/settingsView.js';
import { createSettingsScene, currentThemeId, pruneThemeSelection, THEME_KEY } from '../packages/game/dist/flow/settingsScene.js';

test('设置页、存档清理和票据使用同一主题可用性：保留 draft，排除 retired', () => {
  const content = loadContent();
  content.themes.items.push({ id: 'retired', status: 'retired', scenery: 'library' });
  const values = new Map([[THEME_KEY, 'retired']]);
  const storage = { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
  assert.equal(themeOptions(content).some(theme => theme.id === 'retired'), false);
  assert.equal(themeOptions(content).some(theme => theme.id === 'theme_library'), true);
  assert.equal(currentThemeId(storage, content), 'theme_seaside_day');
  pruneThemeSelection(storage, content);
  assert.equal(storage.get(THEME_KEY), null);
  let actions;
  createSettingsScene({ storage, content: () => content, goSelect() {}, stopDeathMusic() {},
    views: { renderSettings(_content, value) { actions = value; }, toast() {} },
  }).onEnter();
  assert.equal(actions.onSelectTheme('retired'), false);
  assert.equal(actions.onSelectTheme('theme_library'), true);
  assert.equal(currentThemeId(storage, content), 'theme_library');
});
