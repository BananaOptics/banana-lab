import {
  cleanLengthForRawLength,
  decodeNidekNativeTrace,
  isPlausibleNidekNativeHeader,
  MIN_CLEAN_FRAME_LENGTH,
  NIDEK_FRAME_HEADER_LENGTH,
  NIDEK_FRAME_PREFIX,
  traceSummary,
  type DecodedNidekTrace,
} from "@/lib/nidek-native";
import { hex, type SerialLogEntry, type WebSerialTransport } from "@/lib/web-serial-transport";

const ACK = 0x06;
const ENQ = 0x05;
const EOT = 0x04;
const READ_COMMAND = Uint8Array.from([0x52, 0x00, 0x00, 0x09, 0x5b]);

export type Lt900Phase =
  | "idle"
  | "handshake"
  | "status"
  | "capture"
  | "decode"
  | "complete"
  | "error";

export interface Lt900Event {
  phase: Lt900Phase;
  message: string;
  progress?: number;
  level?: SerialLogEntry["level"];
}

export interface Lt900ReadOptions {
  onEvent?: (event: Lt900Event) => void;
}

export interface Lt900ReadResult {
  trace: DecodedNidekTrace;
  rawFrame: Uint8Array;
}

export async function readLt900Trace(
  transport: WebSerialTransport,
  options: Lt900ReadOptions = {},
): Promise<Lt900ReadResult> {
  const emit = (event: Lt900Event) => options.onEvent?.(event);

  emit({ phase: "handshake", message: "Sending ENQ.", progress: 5 });
  await transport.write(Uint8Array.from([ENQ]));
  await requireAck(transport, 2_000, "ENQ");

  emit({ phase: "handshake", message: "Sending native read command.", progress: 15 });
  await transport.write(READ_COMMAND);
  await requireAck(transport, 2_000, "native read command");

  emit({ phase: "status", message: "Entering transfer phase.", progress: 25 });
  await transport.write(Uint8Array.from([EOT]));

  const deviceEnq = await transport.queue.readByte(5_000);
  if (deviceEnq !== ENQ) {
    throw new Error(`Expected device ENQ after EOT, received ${formatByte(deviceEnq)}.`);
  }

  await sendAck(transport, "device ENQ");

  const statusCommand = await transport.queue.readByte(30_000);
  if (statusCommand !== 0x52) {
    throw new Error(`Expected status command 52, received ${formatByte(statusCommand)}.`);
  }

  emit({ phase: "status", message: "Status command received.", progress: 35 });
  await sendAck(transport, "status command");

  const statusA = await transport.queue.readBytes(2, 10_000);
  if (!statusA) throw new Error("Timed out waiting for first status part.");
  emit({ phase: "status", message: `Status part ${hex(statusA)}.`, progress: 42 });
  await sendAck(transport, "first status part");

  const statusB = await transport.queue.readBytes(2, 10_000);
  if (!statusB) throw new Error("Timed out waiting for final status part.");
  emit({ phase: "status", message: `Status part ${hex(statusB)}.`, progress: 48 });
  await sendAck(transport, "final status part");

  emit({ phase: "capture", message: "Waiting for native frame marker.", progress: 50 });
  const rawFrame = await captureNativeFrame(transport, emit);

  emit({ phase: "decode", message: "Decoding native trace.", progress: 92 });
  const trace = decodeNidekNativeTrace(rawFrame);
  emit({ phase: "complete", message: `Trace complete: ${traceSummary(trace)}.`, progress: 100 });

  return { trace, rawFrame };
}

async function requireAck(transport: WebSerialTransport, timeoutMs: number, label: string) {
  const ok = await transport.queue.waitForByte(ACK, timeoutMs);
  if (!ok) throw new Error(`Timed out waiting for ACK after ${label}.`);
}

async function sendAck(transport: WebSerialTransport, label: string) {
  await transport.write(Uint8Array.from([ACK]));
  void label;
}

async function captureNativeFrame(
  transport: WebSerialTransport,
  emit: (event: Lt900Event) => void,
): Promise<Uint8Array> {
  const rawFrame: number[] = [];
  const markerDeadline = Date.now() + 30_000;

  while (Date.now() < markerDeadline) {
    const byte = await transport.queue.readByte(Math.max(1, markerDeadline - Date.now()));
    if (byte === null) break;

    if (byte !== NIDEK_FRAME_PREFIX) continue;

    const rest = await transport.queue.readBytes(NIDEK_FRAME_HEADER_LENGTH - 1, Math.max(1, markerDeadline - Date.now()));
    if (!rest) break;

    const header = [byte, ...Array.from(rest)];
    if (isPlausibleNidekNativeHeader(header)) {
      rawFrame.push(...header);
      emit({ phase: "capture", message: `Native frame header found: ${hex(header)}.`, progress: 58 });
      break;
    }
  }

  if (rawFrame.length === 0) {
    throw new Error("Timed out waiting for a plausible native frame header.");
  }

  const captureStarted = Date.now();
  let blockCount = 0;

  while (Date.now() - captureStarted < 60_000) {
    const cleanLength = cleanLengthForRawLength(rawFrame.length);

    if (cleanLength >= MIN_CLEAN_FRAME_LENGTH) {
      const extraByte = await transport.queue.readByte(1_000);
      if (extraByte === null) break;
      if (extraByte === EOT && rawFrame.length % 129 === 0) {
        emit({ phase: "capture", message: "Transfer EOT received.", progress: 90 });
        break;
      }
      rawFrame.push(extraByte);
    } else {
      const byte = await transport.queue.readByte(10_000);
      if (byte === null) {
        throw new Error(`Timed out while reading trace data at ${cleanLength} clean bytes.`);
      }
      rawFrame.push(byte);
    }

    if (rawFrame.length % 129 === 0) {
      blockCount += 1;
      await sendAck(transport, `block ${blockCount}`);
      emit({
        phase: "capture",
        message: `Captured block ${blockCount}.`,
        progress: Math.min(90, 58 + Math.round((cleanLengthForRawLength(rawFrame.length) / MIN_CLEAN_FRAME_LENGTH) * 30)),
      });
    }
  }

  if (cleanLengthForRawLength(rawFrame.length) < MIN_CLEAN_FRAME_LENGTH) {
    throw new Error(`Trace ended too early at ${cleanLengthForRawLength(rawFrame.length)} clean bytes.`);
  }

  return Uint8Array.from(rawFrame);
}

function formatByte(byte: number | null) {
  if (byte === null) return "timeout";
  return byte.toString(16).padStart(2, "0");
}
