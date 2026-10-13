import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class MissionStore {
  constructor(dbPath) {
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallets (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0),
        PRIMARY KEY(user_id, item)
      );
      CREATE TABLE IF NOT EXISTS mission_periods (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_type TEXT NOT NULL CHECK(period_type IN ('daily', 'weekly')),
        period_id TEXT NOT NULL, definitions_json TEXT NOT NULL,
        progress_json TEXT NOT NULL DEFAULT '{}', claimed_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY(user_id, period_type, period_id)
      );
      CREATE TABLE IF NOT EXISTS weekly_characters (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_id TEXT NOT NULL, char_id TEXT NOT NULL,
        PRIMARY KEY(user_id, period_id, char_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL, daily_id TEXT NOT NULL, weekly_id TEXT NOT NULL,
        seed INTEGER NOT NULL, char_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'finished')), finished_at INTEGER,
        payload_hash TEXT, valid_run INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS runs_by_user ON runs(user_id, started_at);
    `);
    this.statements = {
      user: this.db.prepare('SELECT id FROM users WHERE id = ?'),
      createUser: this.db.prepare('INSERT INTO users(id, created_at) VALUES(?, ?)'),
      addPeriod: this.db.prepare(`INSERT OR IGNORE INTO mission_periods
        (user_id, period_type, period_id, definitions_json) VALUES(?, ?, ?, ?)`),
      period: this.db.prepare(`SELECT definitions_json, progress_json, claimed_json
        FROM mission_periods WHERE user_id = ? AND period_type = ? AND period_id = ?`),
      saveProgress: this.db.prepare(`UPDATE mission_periods SET progress_json = ?
        WHERE user_id = ? AND period_type = ? AND period_id = ?`),
      saveClaimed: this.db.prepare(`UPDATE mission_periods SET claimed_json = ?
        WHERE user_id = ? AND period_type = ? AND period_id = ?`),
      wallet: this.db.prepare('SELECT item, amount FROM wallets WHERE user_id = ? ORDER BY item'),
      addWallet: this.db.prepare(`INSERT INTO wallets(user_id, item, amount) VALUES(?, ?, ?)
        ON CONFLICT(user_id, item) DO UPDATE SET amount = amount + excluded.amount`),
      addRun: this.db.prepare(`INSERT INTO runs(id, user_id, started_at, daily_id, weekly_id, seed, char_id)
        VALUES(?, ?, ?, ?, ?, ?, ?)`),
      run: this.db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?'),
      finishRun: this.db.prepare(`UPDATE runs SET status = 'finished', finished_at = ?,
        payload_hash = ?, valid_run = ? WHERE id = ? AND status = 'open'`),
      addCharacter: this.db.prepare(`INSERT OR IGNORE INTO weekly_characters(user_id, period_id, char_id)
        VALUES(?, ?, ?)`),
      characterCount: this.db.prepare('SELECT COUNT(*) AS count FROM weekly_characters WHERE user_id = ? AND period_id = ?'),
    };
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  hasUser(id) { return Boolean(this.statements.user.get(id)); }
  createUser(id, now) { this.statements.createUser.run(id, now); }
  ensurePeriod(userId, period, periodId, definitions) {
    this.statements.addPeriod.run(userId, period, periodId, JSON.stringify(definitions));
    return this.getPeriod(userId, period, periodId);
  }
  getPeriod(userId, period, periodId) {
    const row = this.statements.period.get(userId, period, periodId);
    if (!row) throw new Error('mission period was not initialized');
    return {
      definitions: JSON.parse(row.definitions_json),
      progress: JSON.parse(row.progress_json),
      claimed: JSON.parse(row.claimed_json),
    };
  }
  saveProgress(userId, period, periodId, progress) {
    this.statements.saveProgress.run(JSON.stringify(progress), userId, period, periodId);
  }
  saveClaimed(userId, period, periodId, claimed) {
    this.statements.saveClaimed.run(JSON.stringify(claimed), userId, period, periodId);
  }
  getWallet(userId) {
    return Object.fromEntries(this.statements.wallet.all(userId).map(row => [row.item, row.amount]));
  }
  addWallet(userId, item, amount) { this.statements.addWallet.run(userId, item, amount); }
  createRun(run) {
    this.statements.addRun.run(run.id, run.userId, run.startedAt, run.dailyId, run.weeklyId, run.seed, run.charId);
  }
  getRun(runId, userId) { return this.statements.run.get(runId, userId) ?? null; }
  markRunFinished(runId, finishedAt, hash, validRun) {
    return Number(this.statements.finishRun.run(finishedAt, hash, validRun ? 1 : 0, runId).changes);
  }
  addWeeklyCharacter(userId, periodId, charId) {
    this.statements.addCharacter.run(userId, periodId, charId);
    return Number(this.statements.characterCount.get(userId, periodId).count);
  }
  close() { this.db.close(); }
}
