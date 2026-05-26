import { describe, expect, it } from "vitest";
import { parseTracerTranscriptNdjson, ReplayTransport } from "@/lib/tracer-replay";

describe("tracer transcript replay", () => {
  it("loads NDJSON transcript entries into a replay transport", async () => {
    const entries = parseTracerTranscriptNdjson(
      [
        JSON.stringify({ kind: "protocol", phase: "listen", message: "Waiting." }),
        JSON.stringify({ kind: "rx", bytes: [0x1c, 0x41, 0x1d], message: "rx" }),
      ].join("\n"),
    );
    const transport = new ReplayTransport(entries);

    await expect(transport.queue.readBytes(3, 1)).resolves.toEqual(
      Uint8Array.of(0x1c, 0x41, 0x1d),
    );
  });

  it("rejects non-replayable NDJSON entries", () => {
    expect(() => parseTracerTranscriptNdjson("{broken")).toThrow("not valid JSON");
    expect(() =>
      parseTracerTranscriptNdjson(
        JSON.stringify({ kind: "rx", bytes: [500], message: "bad" }),
      ),
    ).toThrow("not a replayable");
  });
});
