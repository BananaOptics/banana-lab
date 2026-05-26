import type { ByteQueue } from "@/lib/web-serial-transport";

export interface TracerByteTransport {
  readonly queue: Pick<ByteQueue, "readByte" | "readBytes" | "waitForByte">;
  write(bytes: Uint8Array): Promise<void>;
}

export type TracerPhase =
  | "idle"
  | "listen"
  | "handshake"
  | "negotiate"
  | "status"
  | "capture"
  | "decode"
  | "complete"
  | "error";

export interface TracerProtocolEvent {
  phase: TracerPhase;
  message: string;
  progress?: number;
  level?: "info" | "rx" | "tx" | "warning" | "error";
}
