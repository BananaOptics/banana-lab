# Tracer Evidence Signer

This directory contains the narrow AWS upload path for browser tracer evidence.
The bucket stays private. The browser asks the signer for a temporary S3 `PUT`
URL for one allowed evidence object key and then uploads directly to S3.

## Deploy

1. Install this function package with `npm install` in this directory.
2. Build and deploy the SAM template with an exact `AllowedOrigin` value for the
   web app.
3. Set the app environment variable
   `VITE_TRACER_EVIDENCE_SIGNER_URL` to the `SignerUrl` output.

The template creates:

- a private encrypted S3 bucket;
- a lifecycle expiry rule, defaulting to 90 days;
- S3 CORS for direct browser `PUT` uploads;
- an HTTP API and Lambda that signs only `tracer-sessions/` and
  `tracer-demand/` keys.

The signer accepts only the content types currently written by the app and only
returns short-lived upload URLs. Do not put AWS credentials into the frontend.
