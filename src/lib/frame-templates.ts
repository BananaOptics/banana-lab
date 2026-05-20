import { LENS_DESIGN_CONSTANTS } from "@/lib/lens-design-constants";
import { starterPath } from "@/lib/lens-bezier";
import type { LensPath, LensTemplateSnapshot } from "@/lib/lens-design-types";
import type { DrillRecord } from "@/lib/oma";

export interface FrameTemplate {
  id: string;
  name: string;
  description: string;
  dblMm: number;
  drillRecords: DrillRecord[];
  starterPath: LensPath;
  hardware: Array<{
    id: string;
    kind: "bridge" | "temple";
    points: Array<{ x: number; y: number }>;
  }>;
}

const sampleDrills: DrillRecord[] = [
  { id: "template-bridge-a", eye: "B", reference: "C", x1: -21, y1: 16, x2: null, y2: null, diameter: 1.5 },
  { id: "template-bridge-b", eye: "B", reference: "C", x1: -17.5, y1: 16, x2: null, y2: null, diameter: 1.5 },
  { id: "template-temple-a", eye: "B", reference: "C", x1: 22, y1: 11.5, x2: null, y2: null, diameter: 1.5 },
  { id: "template-temple-b", eye: "B", reference: "C", x1: 25, y1: 11.5, x2: null, y2: null, diameter: 1.5 },
];

export const GENERIC_RIMLESS_TEMPLATE: FrameTemplate = {
  id: "generic-rimless-standards-sample",
  name: "Generic rimless standards sample",
  description: "Unbranded four-hole rimless sample geometry for editor validation and design workflow.",
  dblMm: LENS_DESIGN_CONSTANTS.defaultDblMm,
  drillRecords: sampleDrills,
  starterPath: starterPath("panto"),
  hardware: [
    {
      id: "bridge-marker",
      kind: "bridge",
      points: [
        { x: -24, y: 18 },
        { x: -14, y: 18 },
        { x: -9, y: 12 },
      ],
    },
    {
      id: "temple-marker",
      kind: "temple",
      points: [
        { x: 19, y: 14 },
        { x: 29, y: 14 },
        { x: 33, y: 10 },
      ],
    },
  ],
};

export const FRAME_TEMPLATES = [GENERIC_RIMLESS_TEMPLATE];

export function templateSnapshot(template: FrameTemplate): LensTemplateSnapshot {
  return {
    id: template.id,
    name: template.name,
    dblMm: template.dblMm,
    drillRecords: template.drillRecords.map((record) => ({ ...record })),
  };
}
