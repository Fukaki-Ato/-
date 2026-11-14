const { randomBytes } = require('node:crypto');
const { newProfile, publicProfile } = require('./profile.cjs');
const { RUN_TTL_MS, RunError, reject, digest, boardIdFor, exactRequest, runId,
  normalizeReplay, checkTicket } = require('./run-policy.cjs');
const { isMarketAction, createMarketHandler } = require('./market-api.cjs');

function createRunHandler({ store, content, loadSimulation, now = Date.now,
  issue = () => ({ runId: randomBytes(32).toString('base64url'), seed: randomBytes(4).readUInt32BE(0) }) }) {
  const market = createMarketHandler({ store, content, loadSimulation, now });
  return async (event, identity) => {
    if (isMarketAction(event?.action)) return market(event, identity);
    const { playerId, appId } = identity;
    try {
      if (!['run.begin', 'run.finish', 'run.cancel', 'leaderboard.list',
        'welfare.get', 'mission.claim', 'handbook.claim'].includes(event?.action)) {
        reject('INVALID_REQUEST');
      }
      if (event.action === 'run.cancel') {
        exactRequest(event, ['action', 'runId']);
        await store.cancelRun(playerId, runId(event.runId));
        return { ok: true };
      }
      const simulation = loadSimulation();
      if (['welfare.get', 'mission.claim', 'handbook.claim'].includes(event.action)) {
        if (event.action === 'welfare.get') exactRequest(event, ['action']);
        else if (event.action === 'handbook.claim') exactRequest(event, ['action', 'chapterId']);
        else {
          exactRequest(event, ['action', 'period', 'periodId', 'missionId']);
          if (!['daily', 'weekly'].includes(event.period)) reject('INVALID_REQUEST');
        }
        return { ok: true, welfare: await store.welfare(playerId,
          timestamp => newProfile(playerId, content, new Date(timestamp).toISOString()), event, simulation, now) };
      }
      const boardId = boardIdFor(appId, simulation.rulesId);
      if (event.action === 'leaderboard.list') {
        exactRequest(event, ['action']);
        return { ok: true, leaderboard: await store.listLeaderboard(boardId, playerId) };
      }
      if (event.action === 'run.begin') {
        exactRequest(event, ['action', 'charId', 'rulesId', ...(Object.hasOwn(event, 'themeId') ? ['themeId'] : [])]);
        if (event.rulesId !== simulation.rulesId) reject('RULES_MISMATCH');
        const character = simulation.content.characters.items.find(item => item.id === event.charId);
        if (!character || !character.id.startsWith('char_') || character.kind === 'skin'
          || character.status !== 'live') reject('INVALID_CHARACTER');
        if (Object.hasOwn(event, 'themeId') && (typeof event.themeId !== 'string'
          || !simulation.content.themes.items.some(theme => theme.id === event.themeId
            && ['live', 'draft'].includes(theme.status)))) reject('INVALID_THEME');
        const themeId = simulation.resolveRunThemeId(simulation.content, event.themeId);
        const issuedAt = now();
        const run = { ...issue(), playerId, charId: event.charId, themeId, rulesId: simulation.rulesId,
          boardId, status: 'open', issuedAt, expiresAt: issuedAt + RUN_TTL_MS,
          dailyId: simulation.getMissionPeriods(issuedAt).daily.periodId,
          weeklyId: simulation.getMissionPeriods(issuedAt).weekly.periodId };
        await store.createRun(run, () => newProfile(playerId, content, new Date(issuedAt).toISOString()), simulation, now);
        return { ok: true, ticket: { runId: run.runId, seed: run.seed, rulesId: run.rulesId, themeId: run.themeId } };
      }
      const replay = normalizeReplay(event, simulation);
      const payloadHash = digest(replay);
      const run = await store.getRun(event.runId);
      const status = checkTicket(run, playerId, simulation.rulesId, now(), payloadHash, replay.frames);
      // Replays are deterministic CPU work outside the transaction. A consumed
      // identical payload skips CPU, but still passes the transaction recheck.
      const result = status === 'finished' ? null : await simulation.replayRun(run, replay.frames, replay.inputs, replay.finishReason);
      if (result && !result.accepted) reject('REPLAY_REJECTED');
      const finished = await store.finishRun({ runId: event.runId, playerId,
        rulesId: simulation.rulesId, payloadHash, frames: replay.frames, result, now, welfare: simulation,
        rankEligible: replay.finishReason !== 'quit' });
      return { ok: true, profile: publicProfile(finished.profile), accepted: finished.rankEligible };
    } catch (error) {
      return { ok: false, error: { code: error instanceof RunError ? error.code : 'RUN_UNAVAILABLE',
        message: '请求未完成，请检查版本或稍后重试' } };
    }
  };
}

module.exports = { createRunHandler };
