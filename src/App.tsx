import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Cable,
  CheckCircle2,
  Download,
  FileDown,
  Loader2,
  Play,
  PlugZap,
  RotateCcw,
  Unplug,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { TracePreview } from "@/components/TracePreview";
import { readLt900Trace, type Lt900Event, type Lt900Phase } from "@/lib/lt900-protocol";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { buildOmaFiles, type OmaFile } from "@/lib/oma";
import { type SerialLogEntry, WebSerialTransport } from "@/lib/web-serial-transport";

interface UiLogEntry {
  id: number;
  level: SerialLogEntry["level"];
  message: string;
}

interface AppError {
  title: string;
  message: string;
}

const phaseLabels: Record<Lt900Phase, string> = {
  idle: "Idle",
  handshake: "Handshake",
  status: "Status",
  capture: "Capture",
  decode: "Decode",
  complete: "Complete",
  error: "Error",
};

export function App() {
  const serialSupported = WebSerialTransport.isSupported();
  const [connected, setConnected] = useState(false);
  const [portInfo, setPortInfo] = useState<string>("No port selected");
  const [phase, setPhase] = useState<Lt900Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Connect the LT-900 USB serial adapter to begin.");
  const [logs, setLogs] = useState<UiLogEntry[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [trace, setTrace] = useState<DecodedNidekTrace | null>(null);
  const [omaFiles, setOmaFiles] = useState<OmaFile[]>([]);
  const [busy, setBusy] = useState(false);
  const transportRef = useRef<WebSerialTransport | null>(null);
  const logIdRef = useRef(0);

  const primaryOma = useMemo(() => omaFiles.find((file) => file.pointCount === 400) ?? null, [omaFiles]);
  const secondaryOma = useMemo(() => omaFiles.find((file) => file.pointCount === 1000) ?? null, [omaFiles]);

  useEffect(() => {
    const closeTransport = () => {
      void transportRef.current?.close();
      transportRef.current = null;
    };

    window.addEventListener("pagehide", closeTransport);
    window.addEventListener("beforeunload", closeTransport);

    return () => {
      window.removeEventListener("pagehide", closeTransport);
      window.removeEventListener("beforeunload", closeTransport);
      closeTransport();
    };
  }, []);

  const addLog = (entry: Omit<UiLogEntry, "id">) => {
    const id = logIdRef.current;
    logIdRef.current += 1;
    setLogs((current) => [{ id, ...entry }, ...current].slice(0, 80));
  };

  const handleSerialLog = (entry: SerialLogEntry) => {
    if (entry.level === "rx" || entry.level === "tx") {
      addLog({ level: entry.level, message: `${entry.level.toUpperCase()} ${entry.message}` });
      return;
    }
    addLog({ level: entry.level, message: entry.message });
  };

  const connect = async () => {
    if (!serialSupported) return;
    setError(null);
    setBusy(true);

    try {
      const transport = new WebSerialTransport(handleSerialLog);
      await transport.requestAndOpen();
      transportRef.current = transport;
      setConnected(true);
      setPhase("idle");
      setProgress(0);
      setStatusText("Serial port connected. Ready to start a trace read.");
      setPortInfo(formatPortInfo(transport.getPortInfo()));
    } catch (connectError) {
      const message = messageFromError(connectError);
      setError({ title: "Connection failed", message });
      setStatusText(message);
      addLog({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  const releasePorts = async () => {
    if (!serialSupported) return;
    setBusy(true);
    setError(null);

    try {
      await transportRef.current?.close();
      transportRef.current = null;
      await WebSerialTransport.closeGrantedPorts(handleSerialLog);
      setConnected(false);
      setPhase("idle");
      setProgress(0);
      setPortInfo("No port selected");
      setStatusText("Granted serial ports released. Select the LT-900 adapter again.");
    } catch (releaseError) {
      const message = messageFromError(releaseError);
      setError({ title: "Release failed", message });
      addLog({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await transportRef.current?.close();
      transportRef.current = null;
      setConnected(false);
      setPhase("idle");
      setProgress(0);
      setPortInfo("No port selected");
      setStatusText("Serial port disconnected.");
    } catch (disconnectError) {
      setError({ title: "Disconnect failed", message: messageFromError(disconnectError) });
    } finally {
      setBusy(false);
    }
  };

  const startTrace = async () => {
    const transport = transportRef.current;
    if (!transport) return;

    setBusy(true);
    setError(null);
    setTrace(null);
    setOmaFiles([]);
    setProgress(0);
    setPhase("handshake");
    setStatusText("Starting LT-900 read sequence.");

    try {
      const result = await readLt900Trace(transport, {
        onEvent: (event) => handleProtocolEvent(event),
      });
      const t = result.trace;
      console.group(`Trace — side=${t.metadata.side}`);
      console.log("side", t.metadata.side);
      console.log("fcrv", t.metadata.fcrv);
      console.log("centerDistanceMm", t.metadata.centerDistanceMm);
      console.log("dblMm", t.metadata.dblMm);
      console.log("hboxMm", t.stats.hboxMm);
      console.log("vboxMm", t.stats.vboxMm);
      console.log("circMm", t.stats.circMm);
      console.log("pointCount", t.stats.pointCount);
      console.log("radii1000", t.radii1000);
      console.log("radii400", t.radii400);
      console.log("cleanFrame (hex)", Array.from(t.cleanFrame).map((b) => b.toString(16).padStart(2, "0")).join(" "));
      console.groupEnd();
      setTrace(result.trace);
      setOmaFiles(buildOmaFiles(result.trace));
    } catch (traceError) {
      const message = messageFromError(traceError);
      setError({ title: "Trace failed", message });
      setPhase("error");
      setStatusText(message);
      addLog({ level: "error", message });
    } finally {
      setBusy(false);
    }
  };

  const resetTrace = () => {
    setTrace(null);
    setOmaFiles([]);
    setError(null);
    setPhase(connected ? "idle" : "idle");
    setProgress(0);
    setStatusText(connected ? "Ready to start a trace read." : "Connect the LT-900 USB serial adapter to begin.");
  };

  const handleProtocolEvent = (event: Lt900Event) => {
    setPhase(event.phase);
    setStatusText(event.message);
    setProgress((current) => event.progress ?? current);
    addLog({ level: event.level ?? "info", message: `${phaseLabels[event.phase]}: ${event.message}` });
  };

  const downloadOma = (file: OmaFile) => {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-normal">Nidek LT-900 STD Trace</h1>
              <Badge variant={connected ? "success" : "secondary"}>{connected ? "Connected" : "Disconnected"}</Badge>
              <Badge variant={serialSupported ? "outline" : "destructive"}>
                {serialSupported ? "Web Serial ready" : "Web Serial unavailable"}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Browser-only frame capture, preview, and OMA export for the LT-900 native STD protocol.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button onClick={connect} disabled={!serialSupported || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}
                Select port
              </Button>
            ) : (
              <Button variant="outline" onClick={disconnect} disabled={busy}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            )}
            <Button onClick={startTrace} disabled={!connected || busy}>
              {busy && phase !== "idle" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start trace
            </Button>
            <Button variant="ghost" onClick={resetTrace} disabled={busy && phase !== "error"}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            {!connected ? (
              <Button variant="ghost" onClick={releasePorts} disabled={!serialSupported || busy}>
                <Unplug className="h-4 w-4" />
                Release ports
              </Button>
            ) : null}
          </div>
        </header>

        {!serialSupported ? (
          <Alert variant="warning">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unsupported browser</AlertTitle>
            <AlertDescription>
              Open this app in a desktop Chromium-based browser such as Chrome or Edge. Web Serial also requires
              localhost during development or HTTPS in production.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{error.title}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>Decoded shape and trace measurements from the latest capture.</CardDescription>
            </CardHeader>
            <CardContent>
              <TracePreview trace={trace} />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Trace Control</CardTitle>
                <CardDescription>{portInfo}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {phase === "complete" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                      ) : (
                        <PlugZap className="h-4 w-4 text-muted-foreground" />
                      )}
                      {phaseLabels[phase]}
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} className="mt-3" />
                  <p className="mt-3 text-sm text-muted-foreground">{statusText}</p>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Button disabled={!primaryOma} onClick={() => primaryOma && downloadOma(primaryOma)}>
                    <Download className="h-4 w-4" />
                    Download 400-point OMA
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!secondaryOma}
                    onClick={() => secondaryOma && downloadOma(secondaryOma)}
                  >
                    <FileDown className="h-4 w-4" />
                    Download 1000-point OMA
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Protocol Log</CardTitle>
                <CardDescription>Recent host and tracer messages.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-zinc-100">
                  {logs.length === 0 ? (
                    <div className="text-zinc-500">No serial activity yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {logs.map((entry) => (
                        <div key={entry.id} className={logClassName(entry.level)}>
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatPortInfo(info: SerialPortInfo | null) {
  if (!info) return "Serial port connected";
  const vendor = info.usbVendorId === undefined ? null : `VID ${info.usbVendorId.toString(16).padStart(4, "0")}`;
  const product = info.usbProductId === undefined ? null : `PID ${info.usbProductId.toString(16).padStart(4, "0")}`;
  return [vendor, product].filter(Boolean).join(" / ") || "Serial port connected";
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logClassName(level: SerialLogEntry["level"]) {
  switch (level) {
    case "rx":
      return "text-sky-300";
    case "tx":
      return "text-emerald-300";
    case "warning":
      return "text-amber-300";
    case "error":
      return "text-red-300";
    default:
      return "text-zinc-300";
  }
}
