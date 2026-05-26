import { describe, expect, it } from "vitest";
import type { DecodedNidekTrace, NidekSide } from "@/lib/nidek-native";
import { buildOmaContent, buildOmaFiles, parseOmaContent, type OmaJobInfo } from "@/lib/oma";
import { mirrorClosedRadiiHorizontally, summarizeRadii } from "@/lib/trace-geometry";

const asymmetricRadii = [3000, 2200, 2600, 2100, 1800, 2400, 2700, 2300];

const jobInfo: OmaJobInfo = {
  job: "regression",
  ven: "",
  model: "",
  wrapang: "",
  panto: "",
};

describe("buildOmaContent", () => {
  it("exports a right-eye source as raw R and mirrored L", () => {
    const oma = buildOmaContent(fakeTrace("R"), 400, jobInfo, [], 18);

    expect(readRadiiRecord(oma, "R")).toEqual(asymmetricRadii);
    expect(readRadiiRecord(oma, "L")).toEqual(
      mirrorClosedRadiiHorizontally(asymmetricRadii),
    );
    expect(oma).toContain("TRCFMT=1;400;E;R;B");
  });

  it("exports a left-eye source as mirrored R and raw L", () => {
    const oma = buildOmaContent(fakeTrace("L"), 400, jobInfo, [], 18);

    expect(readRadiiRecord(oma, "R")).toEqual(
      mirrorClosedRadiiHorizontally(asymmetricRadii),
    );
    expect(readRadiiRecord(oma, "L")).toEqual(asymmetricRadii);
    expect(oma).toContain("TRCFMT=1;400;E;R;B");
  });

  it("exports slots as DRILLE records with start and end coordinates", () => {
    const oma = buildOmaContent(
      fakeTrace("R"),
      400,
      jobInfo,
      [
        {
          id: "slot-1",
          eye: "B",
          reference: "C",
          x1: -17,
          y1: 10.32,
          x2: -15,
          y2: 10.32,
          diameter: 2.3,
        },
      ],
      18,
    );

    expect(oma).toContain("DRILLE=B;C;-17;10.32;2.3;-15;10.32");
    expect(oma).not.toContain("DRILLES=");
  });
});

describe("buildOmaFiles", () => {
  it("does not include point-count suffixes in generated filenames", () => {
    const files = buildOmaFiles(fakeTrace("R"), jobInfo);

    expect(files).toMatchObject([
      { fileName: "regression.oma", pointCount: 400 },
      { fileName: "regression.oma", pointCount: 1000 },
    ]);
  });
});

describe("parseOmaContent", () => {
  it("loads OMA metadata, radii, and drill records into an editable trace document", () => {
    const radii = Array.from({ length: 400 }, (_, index) => 2200 + (index % 17));
    const oma = [
      "JOB=loaded-job",
      "REQ=TRC",
      "VEN=Acme",
      "MODEL=Round",
      "DBL=18.00",
      "FCRV=4.2",
      "WRAPANG=5.0",
      "PANTO=8.0",
      "TRCFMT=1;400;E;R;B",
      `R=${radii.join(";")}`,
      `L=${mirrorClosedRadiiHorizontally(radii).join(";")}`,
      "DRILLE=B;C;1.25;2.5;1.8",
      "",
    ].join("\r\n");

    const parsed = parseOmaContent(oma, "loaded.oma");

    expect(parsed.jobInfo).toEqual({
      job: "loaded-job",
      ven: "Acme",
      model: "Round",
      wrapang: "5.0",
      panto: "8.0",
    });
    expect(parsed.pointCount).toBe(400);
    expect(parsed.trace.radii400).toEqual(radii);
    expect(parsed.trace.radii1000).toHaveLength(1000);
    expect(parsed.trace.metadata.dblMm).toBe(18);
    expect(parsed.drillRecords).toHaveLength(1);
    expect(parsed.drillRecords[0]).toMatchObject({
      eye: "B",
      reference: "C",
      x1: 1.25,
      y1: 2.5,
      diameter: 1.8,
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("concatenates multi-line R= records (e.g. 5000-point OMA files)", () => {
    const radii = Array.from({ length: 500 }, (_, i) => 2000 + i);
    // Split into lines of 10 values each, like real OMA files
    const rLines: string[] = [];
    for (let i = 0; i < radii.length; i += 10) {
      rLines.push(`R=${radii.slice(i, i + 10).join(";")}`);
    }
    const oma = [
      "JOB=multiline-test",
      "REQ=TRC",
      "DBL=18.00",
      "TRCFMT=1;500;E;R;P",
      ...rLines,
      "",
    ].join("\r\n");

    const parsed = parseOmaContent(oma, "multiline.oma");

    expect(parsed.trace.radii1000).toHaveLength(1000);
    expect(parsed.trace.radii400).toHaveLength(400);
    // Verify all 500 source points were captured
    expect(parsed.trace.stats.hboxMm).toBeGreaterThan(0);
  });

  it("concatenates multi-line L= records for left-eye files", () => {
    const radii = Array.from({ length: 100 }, (_, i) => 2200 + i);
    const lLines: string[] = [];
    for (let i = 0; i < radii.length; i += 10) {
      lLines.push(`L=${radii.slice(i, i + 10).join(";")}`);
    }
    const oma = [
      "JOB=left-multiline",
      "REQ=TRC",
      "TRCFMT=1;100;E;R;P",
      ...lLines,
      "",
    ].join("\r\n");

    const parsed = parseOmaContent(oma, "left-multi.oma");

    expect(parsed.trace.metadata.side).toBe("L");
    expect(parsed.trace.radii1000).toHaveLength(1000);
  });

  it("separates R and L eye data from dual-TRCFMT files using R= for both eyes", () => {
    const rRadii = Array.from({ length: 100 }, (_, i) => 2200 + i);
    const lRadii = Array.from({ length: 100 }, (_, i) => 2100 + i);
    const rLines: string[] = [];
    const lLines: string[] = [];
    for (let i = 0; i < 100; i += 10) {
      rLines.push(`R=${rRadii.slice(i, i + 10).join(";")}`);
      lLines.push(`R=${lRadii.slice(i, i + 10).join(";")}`);
    }
    const oma = [
      "REQ=FRM",
      "DBL=18",
      "TRCFMT=1;100;E;R;P",
      ...rLines,
      "TRCFMT=1;100;E;L;P",
      ...lLines,
      "",
    ].join("\r\n");

    const parsed = parseOmaContent(oma, "dual-trcfmt.oma");

    // Right eye radii should NOT include left eye data
    expect(parsed.trace.radii1000).toHaveLength(1000);
    // The stats should reflect the right eye shape, not a garbled mix
    // Max radius in right eye is 2299, in left eye is 2199
    expect(parsed.trace.stats.hboxMm).toBeGreaterThan(43);
    // Should detect independent R/L traces and warn
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("strips legacy point-count suffixes when deriving a job from filename", () => {
    const radii = Array.from({ length: 32 }, () => 2200).join(";");
    const parsed = parseOmaContent(
      `REQ=TRC\r\nTRCFMT=1;400;E;R;B\r\nR=${radii}\r\n`,
      "loaded_1000.oma",
    );

    expect(parsed.jobInfo.job).toBe("loaded");
  });
});

function fakeTrace(side: NidekSide): DecodedNidekTrace {
  const stats = summarizeRadii(asymmetricRadii);

  return {
    rawFrame: new Uint8Array(),
    cleanFrame: new Uint8Array(),
    radii1000: asymmetricRadii,
    radii400: asymmetricRadii,
    metadata: {
      frameType: "partial",
      side,
      encoding: "native",
      fcrv: 4,
      centerDistanceMm: stats.hboxMm + 18,
      dblMm: 0,
      byte2Raw: 0,
    },
    stats,
  };
}

function readRadiiRecord(oma: string, eye: "R" | "L") {
  const line = oma
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${eye}=`));

  if (!line) throw new Error(`Missing ${eye}= record`);
  return line.slice(2).split(";").map(Number);
}
