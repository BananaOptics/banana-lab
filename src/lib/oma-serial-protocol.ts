import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { parseOmaContent, type OmaFile } from "@/lib/oma";
import type { TracerByteTransport, TracerProtocolEvent } from "@/lib/tracer-transport";

export const OMA_ACK = 0x06;
export const OMA_NAK = 0x15;
export const OMA_FS = 0x1c;
export const OMA_GS = 0x1d;
export const OMA_RS = 0x1e;

const CRLF = "\r\n";
const DEFAULT_LISTEN_TIMEOUT_MS = 120_000;
const TRACE_FORMAT_KEY = "TRCFMT";
const TRACE_FORMAT_ALIASES = [TRACE_FORMAT_KEY, "FRMFMT"];
const SOURCE_FORMAT_PREFERENCE = ["4", "3", "1", "2"];

export interface OmaSerialTraceResult {
  trace: DecodedNidekTrace;
  rawPayload: Uint8Array;
  traceArtifact: OmaFile;
}

export interface OmaSerialOptions {
  deviceLabel: string;
  onEvent?: (event: TracerProtocolEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function readOmaSerialTrace(
  transport: TracerByteTransport,
  options: OmaSerialOptions,
): Promise<OmaSerialTraceResult> {
  const formats = new Map<string, string>();
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_LISTEN_TIMEOUT_MS);
  const emit = (event: TracerProtocolEvent) => options.onEvent?.(event);
  let retries = 0;

  emit({
    phase: "listen",
    message: "Listening for OMA tracer messages.",
    progress: 5,
  });

  while (Date.now() < deadline) {
    throwIfAborted(options.signal);
    const framed = await readOmaFrame(
      transport,
      Math.max(1, deadline - Date.now()),
      options.signal,
    );
    if (!framed) continue;

    if (framed.length === 1 && framed[0] === OMA_NAK) {
      retries += 1;
      emit({
        phase: "negotiate",
        level: "warning",
        message: `Tracer sent OMA NAK (${retries}).`,
      });
      if (retries > 50) throw new Error("OMA tracer sent too many NAK responses.");
      continue;
    }

    const text = decodeAscii(framed);
    const records = parseVcaRecords(text);
    await transport.write(Uint8Array.of(OMA_ACK));
    cacheFormats(records, formats);

    if (hasShapeRecords(records)) {
      emit({
        phase: "decode",
        message: "OMA frame shape received. Decoding VCA payload.",
        progress: 88,
      });
      const artifact = liveVcaToOmaArtifact(records, options.deviceLabel);
      const parsed = parseOmaContent(artifact.content, artifact.fileName);
      const ack = buildOmaShapeReceipt(records);
      await transport.write(encodeAscii(ack));
      emit({
        phase: "complete",
        message: `OMA trace complete with ${parsed.trace.stats.pointCount} decoded points.`,
        progress: 100,
      });
      return {
        trace: parsed.trace,
        rawPayload: framed,
        traceArtifact: artifact,
      };
    }

    if (isInitRequest(records)) {
      emit({
        phase: "negotiate",
        message: "OMA tracer initialization requested.",
        progress: 22,
      });
      await transport.write(encodeAscii(buildOmaInitStatusResponse()));
      continue;
    }

    if (isInitAnswer(records)) {
      emit({
        phase: "negotiate",
        message: "OMA tracer capabilities received. Sending selected trace formats.",
        progress: 35,
      });
      await transport.write(encodeAscii(buildOmaInitFormatResponse(records, formats)));
      continue;
    }

    if (hasRequest(records)) {
      emit({
        phase: "negotiate",
        message: "OMA trace request received. Sending trace setup.",
        progress: 52,
      });
      await transport.write(encodeAscii(buildOmaTraceRequestResponse(records, formats)));
      continue;
    }

    if (records.has(TRACE_FORMAT_KEY) || records.has("FRMFMT") || records.has("ZFMT")) {
      emit({
        phase: "negotiate",
        message: "OMA tracer capabilities acknowledged.",
        progress: 30,
      });
    } else {
      emit({
        phase: "listen",
        message: "OMA message acknowledged while waiting for shape data.",
      });
    }
  }

  throw new Error("Timed out waiting for an OMA frame trace.");
}

export function selectFavoriteOmaFormat(values: string[]) {
  const candidates = values
    .map((value) => ({
      value,
      code: omaFormatCode(value),
      angle: omaFormatAngle(value),
      points: omaFormatPointCount(value),
    }))
    .filter((candidate) => candidate.points > 0)
    .sort((a, b) => {
      if (a.angle !== b.angle) {
        if (a.angle === "E") return -1;
        if (b.angle === "E") return 1;
      }

      const formatOrder =
        formatPreferenceIndex(a.code) - formatPreferenceIndex(b.code);
      return formatOrder === 0 ? a.points - b.points : formatOrder;
    });

  return (
    candidates.find((candidate) => candidate.points >= 500)?.value ??
    candidates.find((candidate) => candidate.points >= 256)?.value ??
    candidates[0]?.value ??
    ""
  );
}

export type OmaCrcFormat = "decimal" | "decimal5";

export function formatOmaMessage(
  body: string,
  crcFormat: OmaCrcFormat = "decimal",
) {
  const normalized = ensureOmaBody(stripEnvelope(body));
  const crc = crc16Xmodem(normalized);
  const formattedCrc =
    crcFormat === "decimal5" ? String(crc).padStart(5, "0") : String(crc);

  return `${String.fromCharCode(OMA_FS)}${normalized}CRC=${formattedCrc}${CRLF}${String.fromCharCode(OMA_GS)}`;
}

export function crc16Xmodem(text: string) {
  let crc = 0;

  for (const byte of encodeAscii(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

export function parseVcaRecords(text: string) {
  const records = new Map<string, string[]>();
  let current: string | null = null;

  for (const rawLine of stripEnvelope(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^[\x00-\x1f]+|[\x00-\x1f]+$/g, "").trim();
    if (!line || /^CRC=/i.test(line)) continue;
    const separator = line.indexOf("=");

    if (separator > 0) {
      current = line.slice(0, separator).trim().toUpperCase();
      const value = line.slice(separator + 1).trim();
      records.set(current, [...(records.get(current) ?? []), value]);
      continue;
    }

    if (current) {
      const values = records.get(current) ?? [];
      values[values.length - 1] = `${values[values.length - 1]};${line}`;
      records.set(current, values);
    }
  }

  return records;
}

function liveVcaToOmaArtifact(records: Map<string, string[]>, label: string): OmaFile {
  const right = parseLiveRadii(records, "FRMR", "R");
  const left = parseLiveRadii(records, "FRML", "L");
  const primary = right.length > 0 ? right : left;

  if (primary.length < 32) {
    throw new Error("OMA frame shape did not include enough FRMR or FRML radius samples.");
  }

  const pointCount = primary.length < 700 ? 400 : 1000;
  const model = label.replace(/[^\w .()-]+/g, "").trim();
  const dbl = firstRecord(records, "DBL") || firstRecord(records, "IPD") || "0";
  const content = [
    `JOB=${firstRecord(records, "JOB") || `oma_${new Date().toISOString().replace(/[:.]/g, "-")}`}`,
    "REQ=TRC",
    "VEN=OMA",
    ...(model ? [`MODEL=${model}`] : []),
    `DBL=${dbl}`,
    `TRCFMT=1;${pointCount};E;R;${right.length && left.length ? "B" : right.length ? "R" : "L"}`,
    ...(right.length ? [`R=${right.join(";")}`] : []),
    ...(left.length ? [`L=${left.join(";")}`] : []),
  ].join(CRLF);

  return {
    fileName: `${firstRecord(records, "JOB") || "oma-live-trace"}.oma`,
    content: `${content}${CRLF}`,
    pointCount,
  };
}

function parseLiveRadii(records: Map<string, string[]>, liveKey: string, fileKey: string) {
  const descriptor = selectFavoriteOmaFormat(traceFormatValues(records));
  const expected = omaFormatPointCount(descriptor);
  const value = [...(records.get(liveKey) ?? []), ...(records.get(fileKey) ?? [])].join(";");
  const radii = value
    .split(/[;,]/)
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value));

  if (expected > 0 && radii.length > expected && radii[0] === expected) {
    return radii.slice(-expected);
  }

  return radii;
}

function buildOmaInitStatusResponse() {
  return formatOmaMessage(responseBody(["ANS=INI", "STATUS=0"]));
}

function buildOmaInitFormatResponse(
  records: Map<string, string[]>,
  formats: Map<string, string>,
) {
  const vendor = firstRecord(records, "VEN").toUpperCase();
  const device = firstRecord(records, "DEV");
  const definition = firstRecord(records, "DEF");

  return formatOmaMessage(
    responseBody([
      "ANS=INI",
      "STATUS=0",
      ...(vendor !== "NOP" && device ? [`DEV=${device}`] : []),
      ...(definition ? [`DEF=${definition};8888`] : []),
      traceFormatLine(formats),
      zFormatLine(formats),
      ...(records.has("DRLFMT") && firstRecord(records, "DRLFMT") === "C"
        ? ["DRLFMT=C"]
        : []),
    ]),
    vendor === "BRI" ? "decimal5" : "decimal",
  );
}

function buildOmaTraceRequestResponse(
  records: Map<string, string[]>,
  formats: Map<string, string>,
) {
  const request = firstRecord(records, "REQ");

  return formatOmaMessage(
    responseBody([
      `ANS=${request}`,
      `JOB=${firstRecord(records, "JOB")}`,
      "STATUS=0",
      traceFormatLine(formats),
      zFormatLine(formats),
    ]),
  );
}

function buildOmaShapeReceipt(records: Map<string, string[]>) {
  return formatOmaMessage(
    responseBody([
      `ANS=${firstRecord(records, "ANS") || "TRC"}`,
      `JOB=${firstRecord(records, "JOB")}`,
      "STATUS=0",
    ]),
  );
}

function cacheFormats(records: Map<string, string[]>, formats: Map<string, string>) {
  const traceFavorite = selectReadableTraceFormat(traceFormatValues(records));
  if (traceFavorite && !formats.has(TRACE_FORMAT_KEY)) {
    formats.set(TRACE_FORMAT_KEY, traceFavorite);
  }

  const zFavorite = selectFavoriteOmaFormat(records.get("ZFMT") ?? []);
  if (zFavorite && !formats.has("ZFMT")) {
    formats.set("ZFMT", zFavorite);
  }
}

function hasShapeRecords(records: Map<string, string[]>) {
  return ["FRMR", "FRML", "R", "L"].some((key) => records.has(key));
}

function isInitRequest(records: Map<string, string[]>) {
  return firstRecord(records, "REQ").toUpperCase() === "INI";
}

function isInitAnswer(records: Map<string, string[]>) {
  return firstRecord(records, "ANS").toUpperCase() === "INI";
}

function hasRequest(records: Map<string, string[]>) {
  return Boolean(firstRecord(records, "REQ"));
}

function recordIfPresent(records: Map<string, string[]>, key: string) {
  const value = firstRecord(records, key);
  return value ? [`${key}=${value}`] : [];
}

function firstRecord(records: Map<string, string[]>, key: string) {
  return records.get(key)?.[0] ?? "";
}

function omaFormatPointCount(value: string) {
  const parts = value.split(/[;,]/).map((part) => part.trim());
  const firstUsefulNumber = parts
    .slice(1)
    .map((part) => Number.parseInt(part, 10))
    .find((part) => Number.isFinite(part));
  return firstUsefulNumber ?? 0;
}

function omaFormatCode(value: string) {
  return value.split(/[;,]/)[0]?.trim() ?? "";
}

function omaFormatAngle(value: string) {
  return value.split(/[;,]/)[2]?.trim().toUpperCase() ?? "";
}

function formatPreferenceIndex(code: string) {
  const index = SOURCE_FORMAT_PREFERENCE.indexOf(code);
  return index === -1 ? SOURCE_FORMAT_PREFERENCE.length : index;
}

function traceFormatValues(records: Map<string, string[]>) {
  return TRACE_FORMAT_ALIASES.flatMap((key) => records.get(key) ?? []);
}

function selectReadableTraceFormat(values: string[]) {
  return selectFavoriteOmaFormat(
    values.filter(
      (value) => omaFormatCode(value) === "1" && omaFormatAngle(value) === "E",
    ),
  );
}

function traceFormatLine(formats: Map<string, string>) {
  const value = formats.get(TRACE_FORMAT_KEY);
  if (!value) {
    throw new Error("OMA tracer did not advertise a usable TRCFMT trace format.");
  }

  return `${TRACE_FORMAT_KEY}=${value}`;
}

function zFormatLine(formats: Map<string, string>) {
  const value = formats.get("ZFMT");
  return value ? `ZFMT=${value}` : "";
}

function responseBody(lines: string[]) {
  return `${lines.filter(Boolean).join(CRLF)}${CRLF}${String.fromCharCode(OMA_RS)}`;
}

async function readOmaFrame(
  transport: TracerByteTransport,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  const bytes: number[] = [];

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const byte = await transport.queue.readByte(Math.max(1, deadline - Date.now()), signal);
    if (byte === null) {
      if (bytes.length > 0) {
        throw new Error("Timed out waiting for the OMA message terminator.");
      }

      return null;
    }
    bytes.push(byte);
    if (bytes.length === 1 && byte === OMA_NAK) return Uint8Array.from(bytes);
    if (byte === OMA_GS) return Uint8Array.from(bytes);
  }

  if (bytes.length > 0) {
    throw new Error("Timed out waiting for the OMA message terminator.");
  }

  return null;
}

function stripEnvelope(text: string) {
  return text.replace(/^[\x05\x06\x1c]+/, "").replace(/[\x1d\x04]+$/, "");
}

function ensureOmaBody(value: string) {
  const normalized = value.replace(/\r?\n/g, CRLF);
  if (normalized.endsWith(String.fromCharCode(OMA_RS))) return normalized;
  return `${normalized}${normalized.endsWith(CRLF) ? "" : CRLF}${String.fromCharCode(OMA_RS)}`;
}

function encodeAscii(text: string) {
  return new TextEncoder().encode(text);
}

function decodeAscii(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Trace cancelled.", "AbortError");
}
