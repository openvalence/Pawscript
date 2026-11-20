// seek.js -- the seek coalescer. A <video> handles one seek at a time; while one is in flight, newer requests
// overwrite a single pending slot, so a fast scrub never queues stale seeks and the last request always wins.
//
//   const q = new SeekQueue();
//   q.request(ms)  -> ms to issue now, or null (queued behind the one in flight)
//   q.settle()     -> the in-flight seek finished: ms to issue next, or null when idle (the latest is on screen)

export class SeekQueue {
  inflight = null;   // ms being sought now
  pending = null;    // newest request waiting behind it
  issued = 0;        // seeks actually sent to the element
  dropped = 0;       // requests that were overwritten before being sent

  get busy() { return this.inflight != null; }
  /** The most recent request (what the screen will end up showing). */
  get latest() { return this.pending ?? this.inflight; }

  request(ms) {
    if (this.inflight == null) { this.inflight = ms; this.issued++; return ms; }
    if (this.pending != null) this.dropped++;
    this.pending = ms;
    return null;
  }

  settle() {
    this.inflight = null;
    if (this.pending == null) return null;
    this.inflight = this.pending; this.pending = null; this.issued++;
    return this.inflight;
  }

  reset() { this.inflight = this.pending = null; }
}
