import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const allowedRoots = ["tracer-sessions/", "tracer-demand/"];
const allowedContentTypes = new Set([
  "application/json",
  "application/octet-stream",
  "application/x-ndjson",
  "text/plain;charset=utf-8",
]);

export async function handler(event) {
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";

  if (event.requestContext?.http?.method === "OPTIONS") {
    return response(204, "", origin);
  }

  if (origin !== process.env.ALLOWED_ORIGIN) {
    return response(403, { error: "Origin is not allowed." }, origin);
  }

  if (!process.env.TRACER_EVIDENCE_BUCKET) {
    return response(500, { error: "Evidence bucket is not configured." }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return response(400, { error: "Request body must be JSON." }, origin);
  }

  const key = typeof body.key === "string" ? body.key : "";
  const contentType =
    typeof body.contentType === "string" ? body.contentType : "";

  if (!validKey(key)) {
    return response(400, { error: "Evidence key is not allowed." }, origin);
  }

  if (!allowedContentTypes.has(contentType)) {
    return response(400, { error: "Content type is not allowed." }, origin);
  }

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: process.env.TRACER_EVIDENCE_BUCKET,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
    { expiresIn: Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 300) },
  );

  return response(200, { url }, origin);
}

function validKey(key) {
  if (!allowedRoots.some((root) => key.startsWith(root))) return false;
  if (key.includes("..") || key.includes("//")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(key);
}

function response(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Access-Control-Allow-Origin":
        origin === process.env.ALLOWED_ORIGIN ? origin : process.env.ALLOWED_ORIGIN,
      "Content-Type": "application/json",
    },
    body: body === "" ? "" : JSON.stringify(body),
  };
}
