import { EventEmitter } from "node:events";
import type { Store } from "../db/db.js";

export type EngineEventType =
  | "snapshot"
  | "run.planned"
  | "run.gated"
  | "run.executing"
  | "run.finished"
  | "leg.updated"
  | "paused"
  | "resumed"
  | "error";

export interface EngineEvent {
  id: number;
  ts: number;
  type: EngineEventType;
  payload: unknown;
}

/** Persists every event and fans it out to SSE subscribers. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor(private store: Store) {
    this.emitter.setMaxListeners(200);
  }

  emit(type: EngineEventType, payload: unknown) {
    // Snapshots are stored in their own table; don't double-write them to the event log.
    const id = type === "snapshot" ? 0 : this.store.insertEvent(type, payload);
    const ev: EngineEvent = { id, ts: Date.now(), type, payload };
    this.emitter.emit("event", ev);
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }
}

/** For personal accounts: their activity is private, so nothing is persisted or broadcast. */
export class SilentBus extends EventBus {
  override emit() {}
}
