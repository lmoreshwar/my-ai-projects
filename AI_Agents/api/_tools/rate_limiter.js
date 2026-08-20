'use strict';

// Generic, dependency-free, in-memory sliding-window rate limiter.
//
// IMPORTANT — PER-PROCESS ONLY:
// Counters live in this Node process's memory. If the API runs as more than one instance
// (horizontal scaling), each instance keeps its own counters, so this is a FIRST hardening
// layer, NOT a distributed/global limit. Making the limit accurate across instances requires
// a shared store (e.g. Redis) behind an explicitly trusted `trust proxy` config — tracked as a
// roadmap item, intentionally out of scope for this change (no new infrastructure dependency).
//
// The clock is injectable (`now`) so time-based behaviour can be tested deterministically
// without real sleeping.
class RateLimiter {
  constructor({ windowMs, max, now = Date.now } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.hits = new Map(); // key -> ascending array of event timestamps still inside the window
  }

  // Drop timestamps that have aged out of the window; returns the surviving timestamps.
  _prune(key, t) {
    const arr = this.hits.get(key);
    if (!arr) return [];
    const cutoff = t - this.windowMs;
    const kept = arr.filter((ts) => ts > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  // True when the key has already reached the limit — without recording a new event.
  isLimited(key) {
    const t = this.now();
    return this._prune(key, t).length >= this.max;
  }

  // Record one event for the key; returns the current in-window count.
  record(key) {
    const t = this.now();
    const arr = this._prune(key, t);
    arr.push(t);
    this.hits.set(key, arr);
    return arr.length;
  }

  // Forget all events for the key (e.g. after a successful authentication).
  reset(key) {
    this.hits.delete(key);
  }

  // Milliseconds until the key drops back below the limit (0 when not limited). Useful for
  // a Retry-After header.
  retryAfterMs(key) {
    const t = this.now();
    const arr = this._prune(key, t);
    if (arr.length < this.max) return 0;
    const oldest = arr[0];
    return Math.max(0, this.windowMs - (t - oldest));
  }
}

module.exports = { RateLimiter };
