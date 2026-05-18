import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Cable,
  CheckCircle2,
  ChevronDown,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TracePreview } from "@/components/TracePreview";
import {
  readLt900Trace,
  type Lt900Event,
  type Lt900Phase,
} from "@/lib/lt900-protocol";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { buildOmaFiles, type OmaFile } from "@/lib/oma";
import {
  type SerialLogEntry,
  WebSerialTransport,
} from "@/lib/web-serial-transport";

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

const TRACER_MODELS = [
  { value: "nidek-lt900-std", label: "Nidek LT-900 STD" },
] as const;
type TracerModel = (typeof TRACER_MODELS)[number]["value"];

export function App() {
  const serialSupported = WebSerialTransport.isSupported();
  const [tracerModel, setTracerModel] =
    useState<TracerModel>("nidek-lt900-std");
  const [connected, setConnected] = useState(false);
  const [portInfo, setPortInfo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Lt900Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [logs, setLogs] = useState<UiLogEntry[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [trace, setTrace] = useState<DecodedNidekTrace | null>(null);
  const [omaFiles, setOmaFiles] = useState<OmaFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const transportRef = useRef<WebSerialTransport | null>(null);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  const primaryOma = useMemo(
    () => omaFiles.find((file) => file.pointCount === 400) ?? null,
    [omaFiles],
  );
  const secondaryOma = useMemo(
    () => omaFiles.find((file) => file.pointCount === 1000) ?? null,
    [omaFiles],
  );

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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(e.target as Node)
      ) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addLog = (entry: Omit<UiLogEntry, "id">) => {
    const id = logIdRef.current;
    logIdRef.current += 1;
    setLogs((current) => [...current, { id, ...entry }].slice(-80));
  };

  const handleSerialLog = (entry: SerialLogEntry) => {
    if (entry.level === "rx" || entry.level === "tx") {
      addLog({
        level: entry.level,
        message: `${entry.level.toUpperCase()} ${entry.message}`,
      });
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
      setStatusText("Serial port connected. Ready to start a trace.");
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
      setPortInfo(null);
      setStatusText("Granted serial ports released. Select the adapter again.");
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
      setPortInfo(null);
      setStatusText("Serial port disconnected.");
    } catch (disconnectError) {
      setError({
        title: "Disconnect failed",
        message: messageFromError(disconnectError),
      });
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
    setStatusText("Starting trace read sequence.");
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
      console.log(
        "cleanFrame (hex)",
        Array.from(t.cleanFrame)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" "),
      );
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
    setPhase("idle");
    setProgress(0);
    setStatusText(connected ? "Ready to start a trace." : "");
  };

  const handleProtocolEvent = (event: Lt900Event) => {
    setPhase(event.phase);
    setStatusText(event.message);
    setProgress((current) => event.progress ?? current);
    addLog({
      level: event.level ?? "info",
      message: `${phaseLabels[event.phase]}: ${event.message}`,
    });
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

  const isActivePhase =
    phase !== "idle" && phase !== "complete" && phase !== "error";
  const showStatusBox = connected || phase !== "idle";
  const showReset = trace !== null || error !== null;

  if (!serialSupported) {
    return (
      <main className="min-h-screen bg-background">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="flex max-w-md flex-col items-center gap-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Browser not supported</h2>
              <p className="text-sm text-muted-foreground">
                This app requires the Web Serial API, which is only available in
                desktop Chromium-based browsers.
              </p>
            </div>
            <div className="w-full rounded-lg border bg-muted/40 p-4 text-left">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How to use this app
              </p>
              <ol className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    1
                  </span>
                  <span>
                    Open this page in <strong>Google Chrome</strong> or{" "}
                    <strong>Microsoft Edge</strong> on a desktop computer.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    2
                  </span>
                  <span>
                    Connect your frame tracer to the computer via a{" "}
                    <strong>USB-to-serial adapter</strong>.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    3
                  </span>
                  <span>
                    Click <strong>Select port</strong>, choose the adapter from
                    the browser's port picker, then start a trace.
                  </span>
                </li>
              </ol>
            </div>
            <p className="text-xs text-muted-foreground">
              Firefox, Safari, and mobile browsers do not support Web Serial and
              cannot be used.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-normal">
                Frame Tracer
              </h1>
              <Badge variant={connected ? "success" : "secondary"}>
                {connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label
                htmlFor="tracer-model"
                className="text-xs font-medium text-muted-foreground whitespace-nowrap"
              >
                Tracer model
              </label>
              <select
                id="tracer-model"
                value={tracerModel}
                onChange={(e) => setTracerModel(e.target.value as TracerModel)}
                disabled={connected}
                className="rounded-md border bg-background px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {TRACER_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {connected && (
                <span className="text-xs text-muted-foreground">
                  Disconnect to change.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <Button onClick={connect} disabled={!serialSupported || busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cable className="h-4 w-4" />
                )}
                Connect tracer
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {portInfo && (
                  <span className="text-xs text-muted-foreground">
                    {portInfo}
                  </span>
                )}
                <Button variant="outline" onClick={disconnect} disabled={busy}>
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            )}
            <Button onClick={startTrace} disabled={!connected || busy}>
              {busy && phase !== "idle" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Read trace
            </Button>
            {showReset && (
              <Button
                variant="ghost"
                onClick={resetTrace}
                disabled={busy && phase !== "error"}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            )}
            {!connected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={releasePorts}
                disabled={!serialSupported || busy}
                className="text-muted-foreground"
              >
                <Unplug className="h-3.5 w-3.5" />
                Release ports
              </Button>
            )}
          </div>
        </header>

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
              <CardDescription>
                Decoded shape and trace measurements from the latest capture.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TracePreview trace={trace} isLoading={isActivePhase} />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4 pt-5">
                {showStatusBox && (
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
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {progress}%
                        </span>
                      </div>
                      <Progress value={progress} className="mt-3" />
                      {statusText && (
                        <p className="mt-3 text-sm text-muted-foreground">
                          {statusText}
                        </p>
                      )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="relative" ref={downloadMenuRef}>
                    <div className="flex">
                      <Button
                        className="flex-1 rounded-r-none"
                        disabled={!primaryOma}
                        onClick={() => {
                          primaryOma && downloadOma(primaryOma);
                          setDownloadMenuOpen(false);
                        }}
                      >
                        <Download className="h-4 w-4" />
                        Download OMA
                      </Button>
                      <Button
                        className="rounded-l-none border-l px-2.5"
                        disabled={!primaryOma && !secondaryOma}
                        onClick={() => setDownloadMenuOpen((o) => !o)}
                        aria-label="More download options"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                    {downloadMenuOpen && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!primaryOma}
                          onClick={() => {
                            primaryOma && downloadOma(primaryOma);
                            setDownloadMenuOpen(false);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          400-point OMA
                        </button>
                        <button
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!secondaryOma}
                          onClick={() => {
                            secondaryOma && downloadOma(secondaryOma);
                            setDownloadMenuOpen(false);
                          }}
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          1000-point OMA
                        </button>
                      </div>
                    )}
                  </div>
                  {!primaryOma && !secondaryOma && (
                    <p className="text-center text-xs text-muted-foreground">
                      Capture a trace first to enable downloads.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <button
                  className="flex items-center gap-2 text-left"
                  onClick={() => setLogExpanded((o) => !o)}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${logExpanded ? "" : "-rotate-90"}`}
                  />
                  <div>
                    <CardTitle>Protocol Log</CardTitle>
                    <CardDescription className="mt-1">
                      Recent host and tracer messages.
                    </CardDescription>
                  </div>
                </button>
                {logExpanded && logs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogs([])}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    Clear
                  </Button>
                )}
              </CardHeader>
              {logExpanded && (
                <CardContent>
                  <div className="h-[320px] overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-zinc-100">
                    {logs.length === 0 ? (
                      <div className="text-zinc-500">
                        No serial activity yet.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {logs.map((entry) => (
                          <div
                            key={entry.id}
                            className={logClassName(entry.level)}
                          >
                            {entry.message}
                          </div>
                        ))}
                        <div ref={logEndRef} />
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatPortInfo(info: SerialPortInfo | null) {
  if (!info) return "USB Serial Adapter";
  const vendor =
    info.usbVendorId === undefined
      ? null
      : `VID ${info.usbVendorId.toString(16).padStart(4, "0")}`;
  const product =
    info.usbProductId === undefined
      ? null
      : `PID ${info.usbProductId.toString(16).padStart(4, "0")}`;
  const details = [vendor, product].filter(Boolean).join(" / ");
  return details ? `USB Serial Adapter (${details})` : "USB Serial Adapter";
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
