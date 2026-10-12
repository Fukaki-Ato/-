import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

export class ReplayPoolError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class ReplayPool {
  constructor({ size = 2, maxQueue = 8, timeoutMs = 15_000, content } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 4
      || !Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 64
      || !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 18_000) {
      throw new RangeError('Replay pool limits are outside supported bounds');
    }
    this.size = size;
    this.maxQueue = maxQueue;
    this.timeoutMs = timeoutMs;
    this.content = content;
    this.nextId = 1;
    this.queue = [];
    this.slots = [];
    this.restartCounts = Array(size).fill(0);
    this.closing = false;
    for (let i = 0; i < size; i++) this.slots.push(this.#spawn(i));
  }

  #spawn(index) {
    const workerData = this.content === undefined ? {} : { content: this.content };
    const worker = new Worker(new URL('./replay-worker.mjs', import.meta.url), {
      workerData,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const slot = { index, worker, ready: false, busy: null, dead: false };
    worker.on('message', message => {
      if (message?.type === 'ready') {
        slot.ready = true;
        this.restartCounts[index] = 0;
        this.#dispatch();
        return;
      }
      const job = slot.busy;
      if (!job || message?.id !== job.id) return;
      clearTimeout(job.timer);
      slot.busy = null;
      job.resolve(message.result ?? { accepted: false });
      this.#dispatch();
    });
    worker.on('error', () => this.#markDead(slot, 'replay_worker_failed'));
    worker.on('exit', code => {
      if (slot.busy) {
        const job = slot.busy;
        clearTimeout(job.timer);
        slot.busy = null;
        job.reject(new ReplayPoolError('replay_worker_failed'));
      }
      if (this.closing) return;
      if (!slot.dead && code !== 0) this.#markDead(slot, 'replay_worker_failed');
      const restartCount = ++this.restartCounts[index];
      if (restartCount > 3) {
        this.slots[index] = null;
        if (!this.slots.some(current => current && !current.dead)) {
          for (const queued of this.queue.splice(0)) queued.reject(new ReplayPoolError('replay_unavailable'));
        }
        return;
      }
      setTimeout(() => {
        if (this.closing) return;
        const replacement = this.#spawn(index);
        this.slots[index] = replacement;
        this.#dispatch();
      }, Math.min(1000, 50 * (2 ** (restartCount - 1))));
    });
    return slot;
  }

  #markDead(slot, code) {
    if (slot.dead) return;
    slot.dead = true;
    slot.ready = false;
    if (slot.busy) {
      const job = slot.busy;
      clearTimeout(job.timer);
      slot.busy = null;
      job.reject(new ReplayPoolError(code));
    }
    void slot.worker.terminate();
  }

  #timeout(job) {
    const queuedAt = this.queue.indexOf(job);
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1);
      job.reject(new ReplayPoolError('replay_timeout'));
      this.#dispatch();
      return;
    }
    const slot = this.slots.find(candidate => candidate?.busy === job);
    if (!slot) return;
    slot.dead = true;
    slot.ready = false;
    slot.busy = null;
    job.reject(new ReplayPoolError('replay_timeout'));
    void slot.worker.terminate();
  }

  #dispatch() {
    if (this.closing) return;
    for (const slot of this.slots) {
      if (!slot?.ready || slot.dead || slot.busy || this.queue.length === 0) continue;
      const job = this.queue.shift();
      slot.busy = job;
      try {
        slot.worker.postMessage({ id: job.id, payload: job.payload });
      } catch {
        this.#markDead(slot, 'replay_worker_failed');
      }
    }
  }

  run(payload) {
    if (this.closing || !this.slots.some(slot => slot && !slot.dead)) {
      return Promise.reject(new ReplayPoolError('replay_unavailable'));
    }
    const idle = this.slots.some(slot => slot?.ready && !slot.dead && !slot.busy);
    if (!idle && this.queue.length >= this.maxQueue) {
      return Promise.reject(new ReplayPoolError('replay_busy'));
    }
    return new Promise((resolve, reject) => {
      const job = { id: this.nextId++, payload, resolve, reject, timer: null };
      job.timer = setTimeout(() => this.#timeout(job), this.timeoutMs);
      this.queue.push(job);
      this.#dispatch();
    });
  }

  async close() {
    this.closing = true;
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(new ReplayPoolError('replay_unavailable'));
    }
    const workers = this.slots.map(slot => {
      if (slot?.busy) {
        clearTimeout(slot.busy.timer);
        slot.busy.reject(new ReplayPoolError('replay_unavailable'));
        slot.busy = null;
      }
      return slot?.worker.terminate();
    }).filter(Boolean);
    await Promise.allSettled(workers);
  }
}
