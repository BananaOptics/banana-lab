import { describe, expect, it } from "vitest";
import { getTracerProfile } from "@/lib/tracer-catalog";
import {
  buildTracerDemandArtifact,
  buildTracerSessionArtifacts,
} from "@/lib/tracer-evidence";
import { TracerTranscriptRecorder } from "@/lib/tracer-transcript";
import { DEFAULT_WEB_SERIAL_SETTINGS } from "@/lib/web-serial-transport";

describe("tracer evidence artifacts", () => {
  it("builds unsupported-device demand artifacts", () => {
    const profile = getTracerProfile("nidek-ice-mini");
    const artifact = buildTracerDemandArtifact(
      profile,
      new Date("2026-05-22T12:00:00.000Z"),
      "event-1",
    );
    const body = JSON.parse(artifact.body as string) as Record<string, unknown>;

    expect(artifact.key).toBe("tracer-demand/2026/05/22/event-1.json");
    expect(body).toMatchObject({
      eventId: "event-1",
      profile: {
        id: "nidek-ice-mini",
        supportStatus: "not-supported",
      },
    });
  });

  it("builds success and failure session bundles with replay evidence", () => {
    const transcript = new TracerTranscriptRecorder();
    transcript.recordSerial({
      level: "rx",
      message: "06",
      bytes: Uint8Array.of(0x06),
    });
    transcript.recordProtocol({
      phase: "decode",
      message: "Trace decoded.",
    });

    const serialSettings = {
      ...DEFAULT_WEB_SERIAL_SETTINGS,
      baudRate: 19200,
      parity: "even" as const,
    };
    const artifacts = buildTracerSessionArtifacts({
      profile: getTracerProfile("nidek-lt1200-oma"),
      outcome: {
        sessionId: "session-1",
        startedAt: "2026-05-22T12:00:00.000Z",
        finishedAt: "2026-05-22T12:01:00.000Z",
        status: "success",
      },
      transcript,
      rawPayload: Uint8Array.of(1, 2, 3),
      traceArtifact: {
        fileName: "trace.oma",
        content: "JOB=trace\r\n",
        pointCount: 400,
      },
      serialSettings,
    });
    const manifest = JSON.parse(artifacts[0].body as string) as Record<
      string,
      unknown
    >;

    expect(artifacts.map((artifact) => artifact.key)).toEqual([
      "tracer-sessions/2026/05/22/session-1/manifest.json",
      "tracer-sessions/2026/05/22/session-1/communication.ndjson",
      "tracer-sessions/2026/05/22/session-1/raw-payload.bin",
      "tracer-sessions/2026/05/22/session-1/trace.oma",
    ]);
    expect(manifest).toMatchObject({
      outcome: { status: "success" },
      transport: { serial: { baudRate: 19200, parity: "even" } },
      artifacts: {
        transcript: "communication.ndjson",
        rawPayload: "raw-payload.bin",
        trace: "trace.oma",
      },
    });
    expect(artifacts[1].body).toContain('"kind":"rx"');

    const failed = buildTracerSessionArtifacts({
      profile: getTracerProfile("nidek-lt1200-oma"),
      outcome: {
        sessionId: "session-2",
        startedAt: "2026-05-22T12:00:00.000Z",
        finishedAt: "2026-05-22T12:01:00.000Z",
        status: "failed",
        error: "Timed out.",
      },
      transcript,
    });

    expect(failed).toHaveLength(2);
    expect(JSON.parse(failed[0].body as string)).toMatchObject({
      outcome: { status: "failed", error: "Timed out." },
      artifacts: { rawPayload: null, trace: null },
    });
  });
});
