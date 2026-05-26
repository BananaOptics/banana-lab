import type { TracerTranscriptEntry } from "@/lib/tracer-transcript";
import type { TracerByteTransport } from "@/lib/tracer-transport";
import { ByteQueue } from "@/lib/web-serial-transport";

export class ReplayTransport implements TracerByteTransport {
  readonly queue = new ByteQueue();
  readonly writes: Uint8Array[] = [];

  constructor(entries: Pick<TracerTranscriptEntry, "kind" | "bytes">[]) {
    for (const entry of entries) {
      if (entry.kind === "rx" && entry.bytes) {
        this.queue.push(Uint8Array.from(entry.bytes));
      }
    }
  }

  async write(bytes: Uint8Array) {
    this.writes.push(bytes.slice());
  }
}

export function parseTracerTranscriptNdjson(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let entry: unknown;

      try {
        entry = JSON.parse(line);
      } catch {
        throw new Error(`Transcript line ${index + 1} is not valid JSON.`);
      }

      if (!isReplayEntry(entry)) {
        throw new Error(`Transcript line ${index + 1} is not a replayable entry.`);
      }

      return entry;
    });
}

function isReplayEntry(
  value: unknown,
): value is Pick<TracerTranscriptEntry, "kind" | "bytes"> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;

  return (
    (entry.kind === "rx" || entry.kind === "tx" || entry.kind === "protocol" || entry.kind === "serial") &&
    (entry.bytes === undefined ||
      (Array.isArray(entry.bytes) &&
        entry.bytes.every(
          (byte) =>
            typeof byte === "number" &&
            Number.isInteger(byte) &&
            byte >= 0 &&
            byte <= 255,
        )))
  );
}
