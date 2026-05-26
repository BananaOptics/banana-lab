import {
  formatOmaMessage,
  OMA_ACK,
  OMA_NAK,
  parseVcaRecords,
} from "@/lib/oma-serial-protocol";
import type { TracerByteTransport } from "@/lib/tracer-transport";
import { ByteQueue } from "@/lib/web-serial-transport";

export type OmaSimulatorScenario =
  | "success"
  | "fragmented"
  | "nak-then-success"
  | "malformed-shape"
  | "unsupported-format"
  | "timeout";

export interface OmaSimulatorOptions {
  pointCount?: number;
  scenario?: OmaSimulatorScenario;
}

type OmaSimulatorPhase =
  | "idle"
  | "init-request-sent"
  | "init-request-acknowledged"
  | "init-answer-sent"
  | "init-answer-acknowledged"
  | "trace-request-sent"
  | "trace-request-acknowledged"
  | "shape-sent"
  | "complete";

export class OmaSimulatorTransport implements TracerByteTransport {
  readonly queue = new ByteQueue();
  readonly writes: Uint8Array[] = [];
  readonly hostMessages: Map<string, string[]>[] = [];

  private phase: OmaSimulatorPhase = "idle";
  private readonly pointCount: number;
  private readonly scenario: OmaSimulatorScenario;

  constructor(options: OmaSimulatorOptions = {}) {
    this.pointCount = options.pointCount ?? 400;
    this.scenario = options.scenario ?? "success";
    if (this.scenario === "timeout") return;

    if (this.scenario === "nak-then-success") {
      this.queue.push(Uint8Array.of(OMA_NAK));
    }

    this.sendInitRequest();
  }

  async write(bytes: Uint8Array) {
    const copy = bytes.slice();
    this.writes.push(copy);

    if (copy.length === 1 && copy[0] === OMA_ACK) {
      this.advanceAfterAck();
      return;
    }

    const records = parseVcaRecords(new TextDecoder().decode(copy));
    this.hostMessages.push(records);
    this.advanceAfterHostMessage(records);
  }

  private advanceAfterAck() {
    if (this.phase === "init-request-sent") {
      this.phase = "init-request-acknowledged";
      return;
    }

    if (this.phase === "init-answer-sent") {
      this.phase = "init-answer-acknowledged";
      return;
    }

    if (this.phase === "trace-request-sent") {
      this.phase = "trace-request-acknowledged";
      return;
    }

    if (this.phase === "shape-sent") {
      this.phase = "complete";
    }
  }

  private advanceAfterHostMessage(records: Map<string, string[]>) {
    if (
      this.phase === "init-request-acknowledged" &&
      records.get("ANS")?.[0] === "INI"
    ) {
      this.sendInitAnswer();
      return;
    }

    if (
      this.phase === "init-answer-acknowledged" &&
      records.get("ANS")?.[0] === "INI"
    ) {
      this.sendTraceRequest();
      return;
    }

    if (
      this.phase === "trace-request-acknowledged" &&
      records.get("ANS")?.[0] === "TRC"
    ) {
      this.sendShape();
    }
  }

  private sendInitRequest() {
    const format =
      this.scenario === "unsupported-format"
        ? `TRCFMT=4;${this.pointCount};E;R`
        : [
            `TRCFMT=1;${this.pointCount};E;R`,
            `TRCFMT=1;${Math.max(600, this.pointCount)};E;R`,
            `ZFMT=1;${this.pointCount};E;R`,
          ].join("\r\n");

    this.sendFrame(
      formatOmaMessage(
        ["REQ=INI", format].filter(Boolean).join("\r\n"),
      ),
    );
    this.phase = "init-request-sent";
  }

  private sendInitAnswer() {
    const format =
      this.scenario === "unsupported-format"
        ? `TRCFMT=4;${this.pointCount};E;R`
        : [
            `TRCFMT=1;${this.pointCount};E;R`,
            `TRCFMT=1;${Math.max(600, this.pointCount)};E;R`,
            `ZFMT=1;${this.pointCount};E;R`,
          ].join("\r\n");

    this.sendFrame(
      formatOmaMessage(
        [
          "ANS=INI",
          "DEV=fixture-device",
          "DEF=fixture-definition",
          "VEN=SIM",
          "MODEL=Fixture",
          format,
        ]
          .filter(Boolean)
          .join("\r\n"),
      ),
    );
    this.phase = "init-answer-sent";
  }

  private sendTraceRequest() {
    const format =
      this.scenario === "unsupported-format"
        ? `TRCFMT=4;${this.pointCount};E;R`
        : `TRCFMT=1;${this.pointCount};E;R`;

    this.sendFrame(
      formatOmaMessage(
        [
          "REQ=TRC",
          "JOB=fixture",
          "DBL=18.00",
          format,
        ].join("\r\n"),
      ),
    );
    this.phase = "trace-request-sent";
  }

  private sendShape() {
    const radii =
      this.scenario === "malformed-shape"
        ? [2200, 2201, 2202]
        : Array.from({ length: this.pointCount }, (_, index) => 2200 + (index % 13));

    this.sendFrame(
      formatOmaMessage(
        [
          "ANS=TRC",
          "JOB=fixture",
          "DBL=18.00",
          `TRCFMT=1;${this.pointCount};E;R`,
          `R=${radii.join(";")}`,
        ].join("\r\n"),
      ),
    );
    this.phase = "shape-sent";
  }

  private sendFrame(frame: string) {
    const bytes = new TextEncoder().encode(frame);

    if (this.scenario !== "fragmented") {
      this.queue.push(bytes);
      return;
    }

    for (let index = 0; index < bytes.length; index += 7) {
      this.queue.push(bytes.slice(index, index + 7));
    }
  }
}
