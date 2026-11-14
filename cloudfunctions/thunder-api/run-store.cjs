const { reject, checkTicket, betterRecord, creditProfile, recordIdFor, playerNameFor } = require('./run-policy.cjs');
const RUNS = 'thunder_runs', RECORDS = 'thunder_first_coin', META = 'thunder_rank_order';
const { ensureWelfare, touchProfile, recordWelfareRun } = require('./welfare-policy.cjs');

function createRunStore(db, profiles) {
  return {
    async createRun(run, initialize, welfare, now) {
      return db.runTransaction(async transaction => {
        const player = transaction.collection(profiles).doc(run.playerId);
        const { data: existing } = await player.get();
        const timestamp = now();
        const state = ensureWelfare(existing ?? initialize(), welfare, timestamp);
        const profile = existing && state.changed ? touchProfile(state.profile, timestamp) : state.profile;
        if (!profile.inventory.characters.includes(run.charId)) reject('CHARACTER_NOT_OWNED');
        const ticket = transaction.collection(RUNS).doc(run.runId);
        if ((await ticket.get()).data) reject('RUN_CONFLICT');
        if (!existing || state.changed) await player.set({ data: profile });
        await ticket.set({ data: run });
      });
    },
    async getRun(runId) {
      return (await db.collection(RUNS).doc(runId).get()).data;
    },
    async cancelRun(playerId, runId) {
      return db.runTransaction(async transaction => {
        const ticket = transaction.collection(RUNS).doc(runId);
        const { data: run } = await ticket.get();
        if (!run || run.playerId !== playerId || run.status !== 'open') reject('RUN_UNAVAILABLE');
        await ticket.update({ data: { status: 'cancelled' } });
      });
    },
    async finishRun({ runId, playerId, rulesId, payloadHash, frames, result, now, rankEligible, welfare }) {
      return db.runTransaction(async transaction => {
        const timestamp = now();
        const ticket = transaction.collection(RUNS).doc(runId);
        const { data: run } = await ticket.get();
        const status = checkTicket(run, playerId, rulesId, timestamp, payloadHash, frames);
        const player = transaction.collection(profiles).doc(playerId);
        const { data: profile } = await player.get();
        if (!profile) reject('PROFILE_UNAVAILABLE');
        if (status === 'finished') return { profile, rankEligible: run.rankEligible };
        if (!result?.accepted) reject('RUN_CONFLICT');
        const next = recordWelfareRun(creditProfile(profile, result, timestamp), run, result, welfare, timestamp);
        const record = transaction.collection(RECORDS).doc(recordIdFor(run.boardId, playerId));
        const previous = rankEligible ? (await record.get()).data : null;
        if (rankEligible && betterRecord(result.firstCoinRecord, previous)) {
          // A persistent per-board counter serializes accepted improvements,
          // making same-score first-arrival order stable across instances.
          const counter = transaction.collection(META).doc(run.boardId);
          const { data: current } = await counter.get();
          const order = (current?.sequence ?? 0) + 1;
          if (!Number.isSafeInteger(order)) reject('PROFILE_LIMIT');
          next.firstCoinBest = { ...result.firstCoinRecord, charId: run.charId, rulesId,
            achievedAt: new Date(timestamp).toISOString(), order };
          await counter.set({ data: { sequence: order } });
          await record.set({ data: { boardId: run.boardId, playerId,
            playerName: playerNameFor(playerId), ...next.firstCoinBest } });
        }
        await player.set({ data: next });
        await ticket.update({ data: { status: 'finished', payloadHash, rankEligible,
          finishedAt: timestamp, summary: result.summary, firstCoinRecord: result.firstCoinRecord } });
        return { profile: next, rankEligible };
      });
    },
    async listLeaderboard(boardId, playerId) {
      const records = db.collection(RECORDS);
      const { data: top } = await records.where({ boardId }).orderBy('distance', 'desc')
        .orderBy('score', 'desc').orderBy('order', 'asc').limit(50).get();
      const entries = top.map((row, index) => entry(row, index + 1));
      const { data: personalRow } = await records.doc(recordIdFor(boardId, playerId)).get();
      let personal = null;
      if (personalRow) {
        const _ = db.command;
        const { total } = await records.where(_.and([{ boardId }, _.or([
          { distance: _.gt(personalRow.distance) },
          { distance: personalRow.distance, score: _.gt(personalRow.score) },
          { distance: personalRow.distance, score: personalRow.score, order: _.lt(personalRow.order) },
        ])])).count();
        personal = entry(personalRow, total + 1);
      }
      return { entries, personal, playerName: playerNameFor(playerId) };
    },
  };
}

function entry(row, rank) {
  return { rank, playerName: row.playerName, distance: row.distance, score: row.score, charId: row.charId };
}

module.exports = { createRunStore, RUNS, RECORDS, META };
