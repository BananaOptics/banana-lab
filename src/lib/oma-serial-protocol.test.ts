import { describe, expect, it } from "vitest";
import {
  crc16Xmodem,
  formatOmaMessage,
  OMA_ACK,
  parseVcaRecords,
  readOmaSerialTrace,
  selectFavoriteOmaFormat,
} from "@/lib/oma-serial-protocol";
import { OmaSimulatorTransport } from "@/lib/oma-simulator";
import { ReplayTransport } from "@/lib/tracer-replay";
import type { TracerTranscriptEntry } from "@/lib/tracer-transcript";
import fixture from "@/test-fixtures/tracer/oma-host-exchange.json";

describe("OMA serial protocol", () => {
  it("selects the first sorted trace format above the preferred threshold", () => {
    expect(selectFavoriteOmaFormat(["1;256;E;R", "1;1000;E;R", "1;600;E;R"])).toBe(
      "1;600;E;R",
    );
    expect(selectFavoriteOmaFormat(["1;600;U;R", "3;256;E;R", "4;600;E;R"])).toBe(
      "4;600;E;R",
    );
  });

  it("formats source-shaped framed OMA messages with decimal CRC fields", () => {
    expect(crc16Xmodem("123456789")).toBe(0x31c3);
    expect(formatOmaMessage("ANS=INI\r\nSTATUS=0")).toBe(fixture.initStatusFrame);
  });

  it("keeps continued VCA shape lines on the previous field", () => {
    const records = parseVcaRecords("\x1cR=1;2;3\r\n4;5;6\r\n\x1eCRC=0000\r\n\x1d");

    expect(records.get("R")).toEqual(["1;2;3;4;5;6"]);
    expect(records.has("CRC")).toBe(false);
  });

  it("replays a source-shaped trace exchange without hardware", async () => {
    const radii = Array.from({ length: 400 }, (_, index) => 2200 + (index % 13));
    const transcript: Pick<TracerTranscriptEntry, "kind" | "bytes">[] = [
      rx(formatOmaMessage("REQ=INI\r\nTRCFMT=1;400;E;R\r\nTRCFMT=1;600;E;R\r\nZFMT=1;400;E;R")),
      rx(
        formatOmaMessage(
          "ANS=INI\r\nDEV=fixture-device\r\nDEF=fixture-definition\r\nVEN=SIM\r\nMODEL=Fixture\r\nTRCFMT=1;400;E;R\r\nTRCFMT=1;600;E;R\r\nZFMT=1;400;E;R",
        ),
      ),
      rx(formatOmaMessage("REQ=TRC\r\nJOB=fixture\r\nDBL=18.00\r\nTRCFMT=1;400;E;R")),
      rx(
        formatOmaMessage(
          `ANS=TRC\r\nJOB=fixture\r\nDBL=18.00\r\nTRCFMT=1;400;E;R\r\nR=${radii.join(";")}`,
        ),
      ),
    ];
    const transport = new ReplayTransport(transcript);

    const result = await readOmaSerialTrace(transport, {
      deviceLabel: "Fixture OMA",
      timeoutMs: 100,
    });

    expect(result.trace.radii400).toEqual(radii);
    expect(result.trace.metadata.dblMm).toBe(18);
    expect(result.traceArtifact.content).toContain("R=2200;2201");
    expect(transport.writes.filter((write) => write[0] === OMA_ACK)).toHaveLength(4);
    expect(new TextDecoder().decode(transport.writes[1])).toBe(fixture.initStatusFrame);
    expect(new TextDecoder().decode(transport.writes[3])).toBe(fixture.initFormatFrame);
    expect(new TextDecoder().decode(transport.writes[5])).toBe(fixture.traceSetupFrame);
    expect(new TextDecoder().decode(transport.writes[7])).toBe(fixture.traceReceiptFrame);
  });

  it("runs through the active OMA simulator", async () => {
    const transport = new OmaSimulatorTransport();

    const result = await readOmaSerialTrace(transport, {
      deviceLabel: "Simulator OMA",
      timeoutMs: 500,
    });

    expect(result.trace.radii400).toHaveLength(400);
    expect(transport.hostMessages.map((records) => records.get("ANS")?.[0])).toEqual([
      "INI",
      "INI",
      "TRC",
      "TRC",
    ]);
  });

  it("uses the padded CRC branch for BRI initialization answers", async () => {
    const radii = Array.from({ length: 400 }, (_, index) => 2200 + (index % 13));
    const transport = new ReplayTransport([
      rx(
        formatOmaMessage(
          "ANS=INI\r\nDEV=d24\r\nDEF=x\r\nVEN=BRI\r\nMODEL=Fixture\r\nTRCFMT=1;400;E;R",
        ),
      ),
      rx(formatOmaMessage("REQ=TRC\r\nJOB=fixture\r\nTRCFMT=1;400;E;R")),
      rx(
        formatOmaMessage(
          `ANS=TRC\r\nJOB=fixture\r\nTRCFMT=1;400;E;R\r\nR=${radii.join(";")}`,
        ),
      ),
    ]);

    await readOmaSerialTrace(transport, {
      deviceLabel: "BRI fixture",
      timeoutMs: 100,
    });

    expect(new TextDecoder().decode(transport.writes[1])).toBe(
      fixture.decimal5InitFrame,
    );
  });
});

function rx(text: string) {
  return { kind: "rx" as const, bytes: Array.from(new TextEncoder().encode(text)) };
}
