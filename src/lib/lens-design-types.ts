import type { DrillRecord, OmaJobInfo } from "@/lib/oma";

export interface LensPoint {
  x: number;
  y: number;
}

export interface LensPath {
  id: string;
  anchors: LensAnchor[];
  closed: true;
}

export interface LensAnchor {
  id: string;
  point: LensPoint;
  inHandle: LensPoint | null;
  outHandle: LensPoint | null;
  kind: "smooth" | "corner";
}

export interface LensReferenceTrace {
  id: string;
  label: string;
  radii: number[];
  pointCount: number;
}

export interface LensLayerState {
  visible: boolean;
  locked?: boolean;
  opacity?: number;
}

export interface LensLayerSettings {
  face: LensLayerState;
  blanks: LensLayerState;
  template: LensLayerState;
  reference: LensLayerState;
  lens: LensLayerState;
  drills: LensLayerState;
  measurements: LensLayerState;
}

export interface FaceLayerSettings {
  assetId: string;
  xMm: number;
  yMm: number;
  scale: number;
  opacity: number;
}

export interface BlankLayerSettings {
  visible: boolean;
  opacity: number;
  binocularPdMm: number;
  diameterMm: number;
}

export interface LensTemplateSnapshot {
  id: string;
  name: string;
  dblMm: number;
  drillRecords: DrillRecord[];
}

export interface LensViewportState {
  xMm: number;
  yMm: number;
  zoom: number;
}

export interface LensDesignDocument {
  schemaVersion: number;
  id: string;
  name: string;
  jobInfo: OmaJobInfo;
  rightPath: LensPath;
  leftPath?: LensPath;
  symmetryMode: "mirrored" | "independent";
  dblMm: number;
  drills: DrillRecord[];
  templateId: string | null;
  templateSnapshot: LensTemplateSnapshot | null;
  face: FaceLayerSettings;
  blanks: BlankLayerSettings;
  layers: LensLayerSettings;
  viewport: LensViewportState;
  referenceTrace: LensReferenceTrace | null;
}
