import { hex, type SerialLogEntry } from "@/lib/web-serial-transport";
import type { TracerProtocolEvent } from "@/lib/tracer-transport";

export interface TracerTranscriptEntry {
  offsetMs: number;
  kind: "rx" | "tx" | "protocol" | "serial";
  level?: SerialLogEntry["level"];
  bytesHex?: string;
  bytes?: number[];
  phase?: TracerProtocolEvent["phase"];
  message: string;
}

export class TracerTranscriptRecorder {
  readonly startedAt = new Date().toISOString();
  private readonly startedMs = performance.now();
  private readonly entries: TracerTranscriptEntry[] = [];

  recordSerial(entry: SerialLogEntry) {
    this.entries.push({
      offsetMs: this.offset(),
      kind: entry.level === "rx" || entry.level === "tx" ? entry.level : "serial",
      level: entry.level,
      bytesHex: entry.bytes ? hex(entry.bytes) : undefined,
      bytes: entry.bytes ? Array.from(entry.bytes) : undefined,
      message: entry.message,
    });
  }

  recordProtocol(event: TracerProtocolEvent) {
    this.entries.push({
      offsetMs: this.offset(),
      kind: "protocol",
      level: event.level,
      phase: event.phase,
      message: event.message,
    });
  }

  list() {
    return [...this.entries];
  }

  toNdjson() {
    return this.entries.map((entry) => JSON.stringify(entry)).join("\n");
  }

  private offset() {
    return Math.max(0, Math.round(performance.now() - this.startedMs));
  }
}
