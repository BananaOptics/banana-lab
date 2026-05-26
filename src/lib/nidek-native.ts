import { formatNumber, resampleClosedRadii, summarizeRadii, type TraceStats } from "@/lib/trace-geometry";

export const NIDEK_FRAME_PREFIX = 0x46;         // 'F' = full scan
export const NIDEK_FRAME_PREFIX_PARTIAL = 0x50; // 'P' = partial scan
export const NIDEK_FRAME_HEADER_LENGTH = 8;
export const MIN_CLEAN_FRAME_LENGTH = 0x3ef;
export const HEADERLESS_RIMLESS_CLEAN_FRAME_LENGTH = 1001;

export type NidekFrameType = "full" | "partial";
export type NidekSide = "R" | "L" | "B";

export interface NidekMetadata {
  frameType: NidekFrameType;
  side: NidekSide;
  encoding: "native" | "headerless-rimless";
  // Byte 3 / 10: used as frame base curve by the reference decoder.
  // The field name is not exposed there, so "fcrv" is our best guess.
  fcrv: number;
  centerDistanceMm: number;
  dblMm: number;
  // Byte 2 raw value. The reference decoder maps it to a VCA attribute / 10
  // with the same pattern as byte 3. Purpose not confirmed, possibly frame box
  // width in mm. Exposed here so real traces can confirm the meaning.
  byte2Raw: number;
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
  const isHeaderlessRimless = !isPlausibleNidekNativeHeader(cleanFrame.subarray(0, NIDEK_FRAME_HEADER_LENGTH));

  if (!isHeaderlessRimless && cleanFrame.length < MIN_CLEAN_FRAME_LENGTH) {
    throw new Error(`Nidek native frame too short after transport stripping: ${cleanFrame.length} bytes.`);
  }

  if (isHeaderlessRimless && cleanFrame.length < HEADERLESS_RIMLESS_CLEAN_FRAME_LENGTH) {
    throw new Error(`Headerless rimless frame too short after transport stripping: ${cleanFrame.length} bytes.`);
  }

  if (!isHeaderlessRimless && !isPlausibleNidekNativeHeader(cleanFrame.subarray(0, NIDEK_FRAME_HEADER_LENGTH))) {
    throw new Error("Nidek native frame header is invalid after transport stripping.");
  }

  const radii1000 = isHeaderlessRimless ? decodeBestHeaderlessRimlessRadii(cleanFrame) : decodeRadii(cleanFrame);
  const radii400 = resampleClosedRadii(radii1000, 400);
  const stats = summarizeRadii(radii1000);
  const metadata = isHeaderlessRimless ? decodeHeaderlessRimlessMetadata(stats) : decodeMetadata(cleanFrame, stats);

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

export function decodeHeaderlessRimlessRadii(cleanFrame: Uint8Array) {
  return decodeHeaderlessRimlessRadiiAtOffset(cleanFrame, 0);
}

export function decodeBestHeaderlessRimlessRadii(cleanFrame: Uint8Array) {
  const candidates = Array.from({ length: 8 }, (_, offset) => {
    if (cleanFrame.length - offset < HEADERLESS_RIMLESS_CLEAN_FRAME_LENGTH) return null;
    const radii = decodeHeaderlessRimlessRadiiAtOffset(cleanFrame, offset);
    const stats = summarizeRadii(radii);
    const ratio = stats.hboxMm / Math.max(1, stats.vboxMm);
    const ratioScore = Math.abs(ratio - 1.35);
    const boxScore = Math.abs(stats.hboxMm - 52) / 52 + Math.abs(stats.vboxMm - 38) / 38;
    const roundPenalty = Math.max(0, 0.08 - Math.abs(stats.hboxMm - stats.vboxMm) / Math.max(stats.hboxMm, stats.vboxMm)) * 8;

    return { offset, radii, score: ratioScore + boxScore + roundPenalty };
  }).filter((candidate): candidate is { offset: number; radii: number[]; score: number } => candidate !== null);

  return candidates.sort((a, b) => a.score - b.score)[0]?.radii ?? decodeHeaderlessRimlessRadiiAtOffset(cleanFrame, 0);
}

function decodeHeaderlessRimlessRadiiAtOffset(cleanFrame: Uint8Array, startOffset: number) {
  const view = new DataView(cleanFrame.buffer, cleanFrame.byteOffset, cleanFrame.byteLength);
  let current = view.getUint16(startOffset, false);
  const radii = [current];

  for (let offset = startOffset + 2; offset < startOffset + HEADERLESS_RIMLESS_CLEAN_FRAME_LENGTH; offset += 1) {
    const byte = cleanFrame[offset];
    const delta = byte > 127 ? byte - 256 : byte;
    current += delta;
    radii.push(current);
  }

  if (radii.length !== 1000) {
    throw new Error(`Expected 1000 headerless rimless radii, decoded ${radii.length}.`);
  }

  return radii;
}

export function decodeMetadata(cleanFrame: Uint8Array, stats: TraceStats): NidekMetadata {
  const view = new DataView(cleanFrame.buffer, cleanFrame.byteOffset, cleanFrame.byteLength);
  const frameType: NidekFrameType = cleanFrame[0x000] === NIDEK_FRAME_PREFIX ? "full" : "partial";
  const side = decodeSide(cleanFrame[0x001]);
  const byte2Raw = cleanFrame[0x002];
  const fcrv = cleanFrame[0x003] / 10;
  const centerDistanceMm = view.getUint16(0x004, false) / 100;
  const dblMm = Math.max(0, centerDistanceMm - stats.hboxMm);

  return { frameType, side, encoding: "native", fcrv, centerDistanceMm, dblMm, byte2Raw };
}

export function decodeHeaderlessRimlessMetadata(stats: TraceStats): NidekMetadata {
  return {
    frameType: "partial",
    side: "L",
    encoding: "headerless-rimless",
    fcrv: 0,
    centerDistanceMm: stats.hboxMm,
    dblMm: 0,
    byte2Raw: 0,
  };
}

function decodeSide(sideByte: number): NidekSide {
  if (sideByte === 0x01) return "R";
  if (sideByte === 0x02) return "L";
  return "B";
}

export function isPlausibleNidekNativeHeader(header: Uint8Array | number[]) {
  if (header.length < NIDEK_FRAME_HEADER_LENGTH) return false;
  // Accept full (0x46='F') and partial (0x50='P') scans
  if (header[0] !== NIDEK_FRAME_PREFIX && header[0] !== NIDEK_FRAME_PREFIX_PARTIAL) return false;
  // Accept R (1), L (2), and both-sides (3)
  if (header[1] !== 0x01 && header[1] !== 0x02 && header[1] !== 0x03) return false;

  const fcrvTenths = header[3];
  const isRimlessPartialHeader =
    header[0] === NIDEK_FRAME_PREFIX_PARTIAL &&
    fcrvTenths === 0 &&
    header[4] === 0 &&
    header[5] === 0;
  if (!isRimlessPartialHeader && (fcrvTenths < 20 || fcrvTenths > 90)) return false;

  const centerDistance = (header[4] << 8) | header[5];
  if (centerDistance !== 0 && (centerDistance < 4000 || centerDistance > 10000)) return false;

  const firstRadius = (header[6] << 8) | header[7];
  return firstRadius >= 1000 && firstRadius <= 4000;
}

export function traceSummary(trace: DecodedNidekTrace) {
  return [
    `type=${trace.metadata.frameType}`,
    `points=${trace.stats.pointCount}`,
    `hbox=${formatNumber(trace.stats.hboxMm, 2)}`,
    `vbox=${formatNumber(trace.stats.vboxMm, 2)}`,
    `dbl=${formatNumber(trace.metadata.dblMm, 2)}`,
    `circ=${formatNumber(trace.stats.circMm, 2)}`,
    `fcrv=${formatNumber(trace.metadata.fcrv, 1)}`,
    `byte2=${trace.metadata.byte2Raw}`,
  ].join(" ");
}
