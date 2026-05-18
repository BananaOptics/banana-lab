import { formatNumber, resampleClosedRadii, summarizeRadii, type TraceStats } from "@/lib/trace-geometry";

export const NIDEK_FRAME_PREFIX = 0x46;
export const NIDEK_FRAME_HEADER_LENGTH = 8;
export const MIN_CLEAN_FRAME_LENGTH = 0x3ef;

export type NidekSide = "R" | "L" | "B";

export interface NidekMetadata {
  fcrv: number;
  centerDistanceMm: number;
  dblMm: number;
  side: NidekSide;
}

export interface DecodedNidekTrace {
  rawFrame: Uint8Array;
  cleanFrame: Uint8Array;
  radii1000: number[];
  radii400: number[];
  metadata: NidekMetadata;
  stats: TraceStats;
}

export function stripNativeBlockChecksums(frameWithTransportBytes: Uint8Array) {
  const clean: number[] = [];

  for (let index = 0; index < frameWithTransportBytes.length; index += 1) {
    if ((index + 1) % 129 !== 0) clean.push(frameWithTransportBytes[index]);
  }

  return Uint8Array.from(clean);
}

export function cleanLengthForRawLength(rawLength: number) {
  return rawLength - Math.floor(rawLength / 129);
}

export function decodeNidekNativeTrace(rawFrame: Uint8Array): DecodedNidekTrace {
  const cleanFrame = stripNativeBlockChecksums(rawFrame);

  if (cleanFrame.length < MIN_CLEAN_FRAME_LENGTH) {
    throw new Error(`Nidek native frame too short after transport stripping: ${cleanFrame.length} bytes.`);
  }

  if (!isPlausibleNidekNativeHeader(cleanFrame.subarray(0, NIDEK_FRAME_HEADER_LENGTH))) {
    throw new Error("Nidek native frame header is invalid after transport stripping.");
  }

  const radii1000 = decodeRadii(cleanFrame);
  const radii400 = resampleClosedRadii(radii1000, 400);
  const stats = summarizeRadii(radii1000);
  const metadata = decodeMetadata(cleanFrame, stats);

  return {
    rawFrame,
    cleanFrame,
    radii1000,
    radii400,
    metadata,
    stats,
  };
}

export function decodeRadii(cleanFrame: Uint8Array) {
  const view = new DataView(cleanFrame.buffer, cleanFrame.byteOffset, cleanFrame.byteLength);
  let current = view.getUint16(0x006, false);
  const radii = [current];

  for (let offset = 0x008; offset < MIN_CLEAN_FRAME_LENGTH; offset += 1) {
    const byte = cleanFrame[offset];
    const delta = byte > 127 ? byte - 256 : byte;
    current += delta;
    radii.push(current);
  }

  if (radii.length !== 1000) {
    throw new Error(`Expected 1000 radii, decoded ${radii.length}.`);
  }

  return radii;
}

export function decodeMetadata(cleanFrame: Uint8Array, stats: TraceStats): NidekMetadata {
  const view = new DataView(cleanFrame.buffer, cleanFrame.byteOffset, cleanFrame.byteLength);
  const fcrv = cleanFrame[0x003] / 10;
  const centerDistanceMm = view.getUint16(0x004, false) / 100;
  const dblMm = Math.max(0, centerDistanceMm - stats.hboxMm);
  const side = decodeSide(cleanFrame[0x001]);

  return { fcrv, centerDistanceMm, dblMm, side };
}

function decodeSide(sideByte: number): NidekSide {
  if (sideByte === 0x01) return "R";
  if (sideByte === 0x02) return "L";
  return "B";
}

export function isPlausibleNidekNativeHeader(header: Uint8Array | number[]) {
  if (header.length < NIDEK_FRAME_HEADER_LENGTH) return false;
  if (header[0] !== NIDEK_FRAME_PREFIX) return false;
  if (header[1] !== 0x01 && header[1] !== 0x02) return false;

  const fcrvTenths = header[3];
  if (fcrvTenths < 20 || fcrvTenths > 90) return false;

  const centerDistance = (header[4] << 8) | header[5];
  if (centerDistance !== 0 && (centerDistance < 4000 || centerDistance > 10000)) return false;

  const firstRadius = (header[6] << 8) | header[7];
  return firstRadius >= 1000 && firstRadius <= 4000;
}

export function traceSummary(trace: DecodedNidekTrace) {
  return [
    `points=${trace.stats.pointCount}`,
    `hbox=${formatNumber(trace.stats.hboxMm, 2)}`,
    `vbox=${formatNumber(trace.stats.vboxMm, 2)}`,
    `dbl=${formatNumber(trace.metadata.dblMm, 2)}`,
    `circ=${formatNumber(trace.stats.circMm, 2)}`,
    `fcrv=${formatNumber(trace.metadata.fcrv, 1)}`,
  ].join(" ");
}
