import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NAME_PREFIXES = ['闪电', '疾风', '海风', '星河', '霓虹', '银翼', '追光', '云端', '雷霆', '月影'];
const NAME_SUFFIXES = ['跑者', '旅人', '骑士', '勇士', '追风者'];

function makePlayerName() {
  return NAME_PREFIXES[randomInt(NAME_PREFIXES.length)]
    + NAME_SUFFIXES[randomInt(NAME_SUFFIXES.length)] + '-' + randomInt(10, 100);
}

export class LeaderboardStore {
  constructor(dbPath = resolve(process.cwd(), 'data/leaderboard.sqlite')) {
    this.dbPath = dbPath === ':memory:' ? dbPath : resolve(dbPath);
    if (this.dbPath !== ':memory:') mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec([
      'PRAGMA foreign_keys = ON;',
      'PRAGMA journal_mode = WAL;',
      'PRAGMA synchronous = FULL;',
      'PRAGMA busy_timeout = 5000;',
      'CREATE TABLE IF NOT EXISTS players (',
      '  token_hash TEXT PRIMARY KEY,',
      '  player_name TEXT NOT NULL,',
      '  created_at INTEGER NOT NULL',
      ') STRICT;',
      'CREATE TABLE IF NOT EXISTS best_runs (',
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  token_hash TEXT NOT NULL UNIQUE REFERENCES players(token_hash) ON DELETE CASCADE,',
      '  char_id TEXT NOT NULL,',
      '  distance REAL NOT NULL CHECK (distance >= 0),',
      '  score INTEGER NOT NULL CHECK (score >= 0),',
      '  achieved_at INTEGER NOT NULL',
      ') STRICT;',
      'CREATE INDEX IF NOT EXISTS best_runs_order ON best_runs(distance DESC, score DESC, achieved_at ASC, id ASC);',
    ].join('\n'));
    this.insertPlayer = this.db.prepare(
      'INSERT INTO players(token_hash, player_name, created_at) VALUES (?, ?, ?)',
    );
    this.selectPlayer = this.db.prepare('SELECT player_name FROM players WHERE token_hash = ?');
    this.upsertBest = this.db.prepare(
      'INSERT INTO best_runs(token_hash, char_id, distance, score, achieved_at) VALUES (?, ?, ?, ?, ?) '
        + 'ON CONFLICT(token_hash) DO UPDATE SET char_id = excluded.char_id, '
        + 'distance = excluded.distance, score = excluded.score, achieved_at = excluded.achieved_at '
        + 'WHERE excluded.distance > best_runs.distance '
        + 'OR (excluded.distance = best_runs.distance AND excluded.score > best_runs.score)',
    );
    const ranked = [
      'WITH ranked AS (',
      ' SELECT b.token_hash, p.player_name, b.distance, b.score, b.char_id,',
      ' ROW_NUMBER() OVER (ORDER BY b.distance DESC, b.score DESC, b.achieved_at ASC, b.id ASC) AS rank',
      ' FROM best_runs AS b JOIN players AS p USING (token_hash)',
      ')',
    ].join(' ');
    this.selectTop = this.db.prepare(ranked
      + ' SELECT rank, player_name, distance, score, char_id FROM ranked ORDER BY rank LIMIT 50');
    this.selectPersonal = this.db.prepare(ranked
      + ' SELECT rank, player_name, distance, score, char_id FROM ranked WHERE token_hash = ?');
  }

  getPlayer(tokenHash) {
    return this.selectPlayer.get(tokenHash)?.player_name ?? null;
  }

  createPlayer(tokenHash, now = Date.now()) {
    const playerName = makePlayerName();
    this.insertPlayer.run(tokenHash, playerName, now);
    return playerName;
  }

  recordBest({ tokenHash, charId, distance, score, achievedAt = Date.now() * 1000 }) {
    const result = this.upsertBest.run(tokenHash, charId, distance, score, achievedAt);
    return Number(result.changes) > 0;
  }

  list(tokenHash) {
    const entries = this.selectTop.all().map(row => this.#toEntry(row));
    const personalRow = this.selectPersonal.get(tokenHash);
    return {
      entries,
      personal: personalRow ? this.#toEntry(personalRow) : null,
      playerName: this.getPlayer(tokenHash),
    };
  }

  #toEntry(row) {
    return {
      rank: Number(row.rank),
      playerName: row.player_name,
      distance: Number(row.distance),
      score: Number(row.score),
      charId: row.char_id,
    };
  }

  close() {
    this.db.close();
  }
}
