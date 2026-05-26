import type { OmaFile } from "@/lib/oma";
import type { TracerProfile } from "@/lib/tracer-catalog";
import type { TracerTranscriptRecorder } from "@/lib/tracer-transcript";
import type { WebSerialSettings } from "@/lib/web-serial-transport";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";
const SIGNER_URL = import.meta.env.VITE_TRACER_EVIDENCE_SIGNER_URL as
  | string
  | undefined;

export interface EvidenceArtifact {
  key: string;
  body: Blob | string | Uint8Array;
  contentType: string;
}

export interface TracerSessionOutcome {
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "failed" | "cancelled";
  error?: string;
  phase?: string;
}

export function createTracerEvidenceId() {
  return crypto.randomUUID();
}

export async function recordTracerDemand(profile: TracerProfile) {
  const now = new Date();
  const eventId = createTracerEvidenceId();
  return uploadArtifacts([buildTracerDemandArtifact(profile, now, eventId)]);
}

export function buildTracerDemandArtifact(
  profile: TracerProfile,
  now = new Date(),
  eventId: string = createTracerEvidenceId(),
): EvidenceArtifact {
  return {
    key: evidenceKey("tracer-demand", now, `${eventId}.json`),
    contentType: "application/json",
    body: JSON.stringify(
      {
        eventId,
        createdAt: now.toISOString(),
        appVersion: APP_VERSION,
        profile: manifestProfile(profile),
      },
      null,
      2,
    ),
  };
}

export async function uploadTracerSessionBundle({
  profile,
  outcome,
  transcript,
  rawPayload,
  traceArtifact,
  serialSettings,
}: {
  profile: TracerProfile;
  outcome: TracerSessionOutcome;
  transcript: TracerTranscriptRecorder;
  rawPayload?: Uint8Array;
  traceArtifact?: OmaFile;
  serialSettings?: WebSerialSettings;
}) {
  return uploadArtifacts(
    buildTracerSessionArtifacts({
      profile,
      outcome,
      transcript,
      rawPayload,
      traceArtifact,
      serialSettings,
    }),
  );
}

export function buildTracerSessionArtifacts({
  profile,
  outcome,
  transcript,
  rawPayload,
  traceArtifact,
  serialSettings,
}: {
  profile: TracerProfile;
  outcome: TracerSessionOutcome;
  transcript: TracerTranscriptRecorder;
  rawPayload?: Uint8Array;
  traceArtifact?: OmaFile;
  serialSettings?: WebSerialSettings;
}) {
  const now = new Date(outcome.finishedAt);
  const prefix = evidenceKey("tracer-sessions", now, `${outcome.sessionId}/`);
  const artifacts: EvidenceArtifact[] = [
    {
      key: `${prefix}manifest.json`,
      contentType: "application/json",
      body: JSON.stringify(
        {
          appVersion: APP_VERSION,
          outcome,
          profile: manifestProfile(profile),
          transport: {
            connection: profile.connection,
            serial: serialSettings ?? profile.serial ?? null,
          },
          artifacts: {
            transcript: "communication.ndjson",
            rawPayload: rawPayload ? "raw-payload.bin" : null,
            trace: traceArtifact ? traceArtifact.fileName : null,
          },
        },
        null,
        2,
      ),
    },
    {
      key: `${prefix}communication.ndjson`,
      contentType: "application/x-ndjson",
      body: transcript.toNdjson(),
    },
  ];

  if (rawPayload) {
    artifacts.push({
      key: `${prefix}raw-payload.bin`,
      contentType: "application/octet-stream",
      body: rawPayload,
    });
  }

  if (traceArtifact) {
    artifacts.push({
      key: `${prefix}${traceArtifact.fileName}`,
      contentType: "text/plain;charset=utf-8",
      body: traceArtifact.content,
    });
  }

  return artifacts;
}

function evidenceKey(root: string, date: Date, suffix: string) {
  return [
    root,
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    suffix,
  ].join("/");
}

function manifestProfile(profile: TracerProfile) {
  return {
    id: profile.id,
    manufacturer: profile.manufacturer,
    model: profile.model,
    connection: profile.connection,
    driver: profile.driver,
    supportStatus: profile.supportStatus,
    serial: profile.serial ?? null,
  };
}

async function uploadArtifacts(artifacts: EvidenceArtifact[]) {
  if (!SIGNER_URL) return { uploaded: false, reason: "signer-not-configured" } as const;

  await Promise.all(
    artifacts.map(async (artifact) => {
      const signed = await fetch(SIGNER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: artifact.key,
          contentType: artifact.contentType,
        }),
      });

      if (!signed.ok) {
        throw new Error(`Evidence signer rejected ${artifact.key}.`);
      }

      const { url } = (await signed.json()) as { url?: string };
      if (!url) throw new Error(`Evidence signer did not return an upload URL for ${artifact.key}.`);

      const uploaded = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": artifact.contentType },
        body:
          artifact.body instanceof Uint8Array
            ? new Blob([Uint8Array.from(artifact.body).buffer], {
                type: artifact.contentType,
              })
            : artifact.body,
      });

      if (!uploaded.ok) throw new Error(`Evidence upload failed for ${artifact.key}.`);
    }),
  );

  return { uploaded: true } as const;
}
