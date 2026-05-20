import { LENS_DESIGN_CONSTANTS, LENS_DESIGN_SCHEMA_VERSION } from "@/lib/lens-design-constants";
import { clonePath, makeId, radiiToEditablePath, starterPath } from "@/lib/lens-bezier";
import type { FrameTemplate } from "@/lib/frame-templates";
import { templateSnapshot } from "@/lib/frame-templates";
import type { LensDesignDocument, LensLayerSettings, LensPath } from "@/lib/lens-design-types";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import type { DrillRecord, OmaJobInfo } from "@/lib/oma";
import { freshJobName } from "@/lib/oma";

export const DESIGN_HANDOFF_KEY = "banana-lab-open-design";

export function defaultJobInfo(): OmaJobInfo {
  return { job: freshJobName(), ven: "", model: "", wrapang: "", panto: "" };
}

export function defaultLayers(): LensLayerSettings {
  return {
    face: { visible: true, locked: true, opacity: 0.32 },
    blanks: { visible: true, opacity: 0.45 },
    template: { visible: true, locked: true, opacity: 1 },
    reference: { visible: true, locked: true, opacity: 0.35 },
    lens: { visible: true, locked: false, opacity: 0.66 },
    drills: { visible: true, locked: false, opacity: 1 },
    measurements: { visible: true, opacity: 1 },
  };
}

export function createDesignFromPath(path: LensPath, name = "Untitled design"): LensDesignDocument {
  return {
    schemaVersion: LENS_DESIGN_SCHEMA_VERSION,
    id: makeId("design"),
    name,
    jobInfo: defaultJobInfo(),
    rightPath: path,
    symmetryMode: "mirrored",
    dblMm: LENS_DESIGN_CONSTANTS.defaultDblMm,
    drills: [],
    templateId: null,
    templateSnapshot: null,
    face: { assetId: "neutral-face-illustration", xMm: 0, yMm: 0, scale: 1, opacity: 0.32 },
    blanks: {
      visible: true,
      opacity: 0.45,
      binocularPdMm: LENS_DESIGN_CONSTANTS.defaultBlankPdMm,
      diameterMm: LENS_DESIGN_CONSTANTS.defaultBlankDiameterMm,
    },
    layers: defaultLayers(),
    viewport: { xMm: 0, yMm: 0, zoom: 7 },
    referenceTrace: null,
  };
}

export function createBlankDesign(kind: "round" | "panto" | "soft-rectangle" | "aviator" | "cat-eye" = "panto") {
  return createDesignFromPath(starterPath(kind), `${kind.replace("-", " ")} design`);
}

export function createDesignFromTemplate(template: FrameTemplate) {
  const doc = createDesignFromPath(clonePath(template.starterPath), template.name);
  doc.templateId = template.id;
  doc.templateSnapshot = templateSnapshot(template);
  doc.dblMm = template.dblMm;
  doc.drills = template.drillRecords.map((record) => ({ ...record }));
  doc.jobInfo.model = template.name;
  return doc;
}

export function createDesignFromTrace(
  trace: DecodedNidekTrace,
  options: { fileName?: string; jobInfo?: OmaJobInfo; drillRecords?: DrillRecord[]; dblMm?: number } = {},
) {
  const sourceRadii = trace.radii1000.length ? trace.radii1000 : trace.radii400;
  const doc = createDesignFromPath(radiiToEditablePath(sourceRadii), options.fileName ?? "OMA design");
  doc.jobInfo = options.jobInfo ?? defaultJobInfo();
  doc.drills = (options.drillRecords ?? []).map((record) => ({ ...record }));
  doc.dblMm = options.dblMm ?? (trace.metadata.dblMm > 0 ? trace.metadata.dblMm : LENS_DESIGN_CONSTANTS.defaultDblMm);
  doc.referenceTrace = {
    id: makeId("reference"),
    label: options.fileName ?? "Original OMA trace",
    radii: [...sourceRadii],
    pointCount: sourceRadii.length,
  };
  return doc;
}

export function serializeDesign(doc: LensDesignDocument) {
  return JSON.stringify(doc, null, 2);
}

export function parseDesignFile(text: string): LensDesignDocument {
  const data = JSON.parse(text) as unknown;
  if (!isRecord(data)) throw new Error("Design file is not a JSON object.");
  if (!isRecord(data.rightPath) || !Array.isArray(data.rightPath.anchors)) {
    throw new Error("Design file is missing editable lens geometry.");
  }
  if (!Array.isArray(data.drills)) throw new Error("Design file is missing drill feature data.");
  if (!isRecord(data.jobInfo)) throw new Error("Design file is missing job metadata.");
  const doc = data as unknown as LensDesignDocument;
  return {
    ...doc,
    schemaVersion: Number.isFinite(doc.schemaVersion) ? doc.schemaVersion : LENS_DESIGN_SCHEMA_VERSION,
    layers: { ...defaultLayers(), ...doc.layers },
    viewport: doc.viewport ?? { xMm: 0, yMm: 0, zoom: 7 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function downloadTextFile(fileName: string, content: string, type = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
