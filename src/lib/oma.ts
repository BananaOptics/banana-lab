import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { formatNumber } from "@/lib/trace-geometry";

export type OmaPointCount = 400 | 1000;

export interface OmaFile {
  fileName: string;
  content: string;
  pointCount: OmaPointCount;
}

export interface OmaJobInfo {
  job: string;
  ven: string;
  model: string;
  wrapang: string;
  panto: string;
}

export function freshJobName(): string {
  return `trace_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function buildOmaFiles(trace: DecodedNidekTrace, jobInfo: OmaJobInfo): OmaFile[] {
  return [
    {
      fileName: `${jobInfo.job}_400.oma`,
      content: buildOmaContent(trace, 400, jobInfo),
      pointCount: 400,
    },
    {
      fileName: `${jobInfo.job}_1000.oma`,
      content: buildOmaContent(trace, 1000, jobInfo),
      pointCount: 1000,
    },
  ];
}

export function buildOmaContent(trace: DecodedNidekTrace, pointCount: OmaPointCount, jobInfo: OmaJobInfo) {
  const radii = pointCount === 400 ? trace.radii400 : trace.radii1000;
  const wrapang = parseFloat(jobInfo.wrapang);
  const panto = parseFloat(jobInfo.panto);
  const lines = [
    `JOB=${jobInfo.job}`,
    "REQ=TRC",
    ...(jobInfo.ven ? [`VEN=${jobInfo.ven}`] : []),
    ...(jobInfo.model ? [`MODEL=${jobInfo.model}`] : []),
    `HBOX=${formatNumber(trace.stats.hboxMm, 2)}`,
    `VBOX=${formatNumber(trace.stats.vboxMm, 2)}`,
    `DBL=${formatNumber(trace.metadata.dblMm, 2)}`,
    `CIRC=${formatNumber(trace.stats.circMm, 2)}`,
    `FCRV=${formatNumber(trace.metadata.fcrv, 1)}`,
    ...(!isNaN(wrapang) ? [`WRAPANG=${formatNumber(wrapang, 1)}`] : []),
    ...(!isNaN(panto) ? [`PANTO=${formatNumber(panto, 1)}`] : []),
    `TRCFMT=1;${pointCount};E;R;${trace.metadata.dblMm > 0 ? "B" : trace.metadata.side}`,
    ...(trace.metadata.side === "R" || trace.metadata.side === "B" || trace.metadata.dblMm > 0 ? [`R=${radii.join(";")}`] : []),
    ...(trace.metadata.side === "L" || trace.metadata.side === "B" || trace.metadata.dblMm > 0 ? [`L=${radii.join(";")}`] : []),
  ];

  return `${lines.join("\r\n")}\r\n`;
}
