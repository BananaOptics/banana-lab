import { describe, expect, it } from "vitest";
import { formatOmaMessage, readOmaSerialTrace } from "@/lib/oma-serial-protocol";
import { OmaSimulatorTransport } from "@/lib/oma-simulator";
import { ReplayTransport } from "@/lib/tracer-replay";

describe("OMA simulator scenarios", () => {
  it("handles fragmented OMA frames and an initial NAK retry", async () => {
    for (const scenario of ["fragmented", "nak-then-success"] as const) {
      const result = await readOmaSerialTrace(new OmaSimulatorTransport({ scenario }), {
        deviceLabel: scenario,
        timeoutMs: 500,
      });

      expect(result.trace.radii400).toHaveLength(400);
    }
  });

  it("fails clearly for unsupported trace formats and malformed shapes", async () => {
    await expect(
      readOmaSerialTrace(new OmaSimulatorTransport({ scenario: "unsupported-format" }), {
        deviceLabel: "unsupported",
        timeoutMs: 500,
      }),
    ).rejects.toThrow("usable TRCFMT");

    await expect(
      readOmaSerialTrace(new OmaSimulatorTransport({ scenario: "malformed-shape" }), {
        deviceLabel: "malformed",
        timeoutMs: 500,
      }),
    ).rejects.toThrow("did not include enough");
  });

  it("times out on a silent tracer and on an incomplete frame", async () => {
    await expect(
      readOmaSerialTrace(new OmaSimulatorTransport({ scenario: "timeout" }), {
        deviceLabel: "silent",
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Timed out waiting for an OMA frame trace.");

    const truncated = formatOmaMessage("REQ=INI\r\nTRCFMT=1;400;E;R").slice(0, -1);
    await expect(
      readOmaSerialTrace(
        new ReplayTransport([{ kind: "rx", bytes: Array.from(new TextEncoder().encode(truncated)) }]),
        {
          deviceLabel: "truncated",
          timeoutMs: 10,
        },
      ),
    ).rejects.toThrow("terminator");
  });

  it("honors cancellation while waiting for tracer bytes", async () => {
    const controller = new AbortController();
    const pending = readOmaSerialTrace(
      new OmaSimulatorTransport({ scenario: "timeout" }),
      {
        deviceLabel: "cancel",
        signal: controller.signal,
        timeoutMs: 500,
      },
    );

    globalThis.setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
