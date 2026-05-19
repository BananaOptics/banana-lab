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
  Settings,
  Unplug,
  X,
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
import { DrillDialog } from "@/components/DrillDialog";
import { TracePreview } from "@/components/TracePreview";
import {
  readLt900Trace,
  type Lt900Event,
  type Lt900Phase,
} from "@/lib/lt900-protocol";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import {
  buildOmaFiles,
  type DrillRecord,
  freshJobName,
  type OmaFile,
  type OmaJobInfo,
} from "@/lib/oma";
import { buildSimulatedNidekTrace } from "@/lib/simulated-trace";
import {
  mirrorClosedRadiiHorizontally,
  pointIsInsideClosedTrace,
} from "@/lib/trace-geometry";
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

const PXPERMM_KEY = "frame-tracer-px-per-mm";
const THEME_KEY = "frame-tracer-theme";
const CAL_REF_PX = 200;
const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;
type ThemeMode = (typeof THEME_OPTIONS)[number]["value"];

export function App() {
  const serialSupported = WebSerialTransport.isSupported();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    } catch {
      return "system";
    }
  });
  const [tracerModel, setTracerModel] =
    useState<TracerModel>("nidek-lt900-std");
  const [connected, setConnected] = useState(false);
  const [portInfo, setPortInfo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Lt900Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [logs, setLogs] = useState<UiLogEntry[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trace, setTrace] = useState<DecodedNidekTrace | null>(null);
  const [showAsPair, setShowAsPair] = useState(false);
  const [pairDblMm, setPairDblMm] = useState(18);
  const [pairDblInput, setPairDblInput] = useState("18");
  const [zoom, setZoom] = useState<"fit" | "1:1">("fit");
  const [pxPerMm, setPxPerMm] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(PXPERMM_KEY);
      return v ? parseFloat(v) : null;
    } catch {
      return null;
    }
  });
  const [calOpen, setCalOpen] = useState(false);
  const [calDraft, setCalDraft] = useState("");
  const [jobInfo, setJobInfo] = useState<OmaJobInfo>({
    job: "",
    ven: "",
    model: "",
    wrapang: "",
    panto: "",
  });
  const [drillRecords, setDrillRecords] = useState<DrillRecord[]>([]);
  const [drillDialogOpen, setDrillDialogOpen] = useState(false);
  const pairPreviewTrace = useMemo(() => {
    if (!trace || !showAsPair || trace.metadata.side === "B") return null;
    // buildTwoLensPaths always uses radii400 as the right-lens template and mirrors for left.
    // If we captured the left side, mirror first so the geometry comes out correct.
    const radii400 =
      trace.metadata.side === "L"
        ? mirrorClosedRadiiHorizontally(trace.radii400)
        : trace.radii400;
    return { ...trace, radii400, metadata: { ...trace.metadata, dblMm: pairDblMm } };
  }, [trace, showAsPair, pairDblMm]);
  const invalidDrillRecordIds = useMemo(() => {
    if (!trace) return new Set<string>();

    return new Set(
      drillRecords
        .filter(
          (r) =>
            r.diameter <= 0 ||
            !pointIsInsideClosedTrace({ x: r.x1, y: r.y1 }, trace.stats.points),
        )
        .map((r) => r.id),
    );
  }, [drillRecords, trace]);
  const omaFiles = useMemo(
    () => {
      if (!trace) return [];
      // For single-lens traces, use pairDblMm as the OMA DBL when the user has
      // entered it (showAsPair enables the DBL input). This ensures the bridge
      // distance appears in the file for rimless/frameless ordering.
      const dblOverride = (showAsPair && trace.metadata.side !== "B" && pairDblMm > 0)
        ? pairDblMm
        : undefined;
      return buildOmaFiles(trace, jobInfo, drillRecords, dblOverride);
    },
    [trace, jobInfo, drillRecords, showAsPair, pairDblMm],
  );
  const [busy, setBusy] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const transportRef = useRef<WebSerialTransport | null>(null);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const useDark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", useDark);
      document.documentElement.style.colorScheme = useDark ? "dark" : "light";
    };

    applyTheme();
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }

    if (theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

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

  useEffect(() => {
    let typedSequence = "";
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && (event.code === "KeyR" || event.key.toLowerCase() === "r")) {
        event.preventDefault();
        runSimulatedTrace();
        typedSequence = "";
        return;
      }

      if (isTextEntryTarget(event.target)) return;

      typedSequence = `${typedSequence}${event.key.toLowerCase()}`.slice(-8);
      if (typedSequence.endsWith("simtrace")) {
        event.preventDefault();
        runSimulatedTrace();
        typedSequence = "";
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

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
    setShowAsPair(false);
    setDrillRecords([]);
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
      console.log("encoding", t.metadata.encoding);
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
      if (t.metadata.encoding === "headerless-rimless") {
        addLog({
          level: "info",
          message: `Rimless decode: cleanHead=${formatByteHead(t.cleanFrame, 48)} minR=${t.stats.minRadius} maxR=${t.stats.maxRadius} HBOX=${t.stats.hboxMm} VBOX=${t.stats.vboxMm} CIRC=${t.stats.circMm}`,
        });
      }
      setJobInfo((prev) => ({ ...prev, job: freshJobName() }));
      setTrace(result.trace);
      setShowAsPair(result.trace.metadata.side !== "B");
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

  const runSimulatedTrace = () => {
    const simulatedTrace = buildSimulatedNidekTrace();
    setBusy(false);
    setError(null);
    setTrace(null);
    setShowAsPair(false);
    setDrillRecords([]);
    setPhase("complete");
    setProgress(100);
    setStatusText("Simulated trace loaded.");
    setJobInfo((prev) => ({ ...prev, job: freshJobName() }));
    setTrace(simulatedTrace);
    setShowAsPair(simulatedTrace.metadata.side !== "B");
    addLog({
      level: "info",
      message: "Decode: Simulated LT-900 trace loaded.",
    });
  };

  const resetTrace = () => {
    setTrace(null);
    setShowAsPair(false);
    setDrillRecords([]);
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

  const saveCalibration = () => {
    const mm = parseFloat(calDraft);
    if (isNaN(mm) || mm <= 0) return;
    const px = CAL_REF_PX / mm;
    setPxPerMm(px);
    try { localStorage.setItem(PXPERMM_KEY, String(px)); } catch { /* ignore */ }
    setCalOpen(false);
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
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings"
              className="ml-auto"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {error ? (
          <Alert variant="destructive" className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <AlertTitle className="mb-0">{error.title}</AlertTitle>
            <AlertDescription className="col-start-2">{error.message}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <CardTitle>Preview</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border text-xs font-medium">
                    <button
                      className={`px-2.5 py-1 transition-colors ${zoom === "fit" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                      onClick={() => setZoom("fit")}
                    >
                      Fit
                    </button>
                    <button
                      className={`border-l px-2.5 py-1 transition-colors ${zoom === "1:1" ? "bg-primary text-primary-foreground" : "hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-40`}
                      onClick={() => setZoom("1:1")}
                      disabled={!pxPerMm}
                      title={!pxPerMm ? "Calibrate screen scale first" : "True 1:1 physical scale"}
                    >
                      1:1
                    </button>
                  </div>
                  {trace && trace.metadata.side !== "B" && trace.metadata.dblMm === 0 && (
                    <>
                      {showAsPair && (
                        <div className="flex items-center gap-1.5">
                          <label htmlFor="pair-dbl" className="text-xs text-muted-foreground whitespace-nowrap">
                            DBL
                          </label>
                          <input
                            id="pair-dbl"
                            type="text"
                            inputMode="decimal"
                            value={pairDblInput}
                            onChange={(e) => {
                              setPairDblInput(e.target.value);
                              const n = parseFloat(e.target.value);
                              if (!isNaN(n) && n >= 0) setPairDblMm(n);
                            }}
                            className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">mm</span>
                        </div>
                      )}
                      <Button
                        variant={showAsPair ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setShowAsPair((v) => !v)}
                      >
                        {showAsPair ? "Show original" : "Show as pair"}
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <TracePreview
                  trace={pairPreviewTrace ?? trace}
                  drillRecords={drillRecords}
                  invalidDrillRecordIds={invalidDrillRecordIds}
                  isLoading={isActivePhase}
                  zoom={zoom}
                  pxPerMm={pxPerMm}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Frame details</CardTitle>
                <CardDescription>
                  Optional metadata written into the OMA file.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="oma-ven" label="Frame brand" field="VEN" />
                    <input
                      id="oma-ven"
                      value={jobInfo.ven}
                      onChange={(e) =>
                        setJobInfo((p) => ({ ...p, ven: e.target.value }))
                      }
                      placeholder="e.g. Ray-Ban"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="oma-model" label="Frame model" field="MODEL" />
                    <input
                      id="oma-model"
                      value={jobInfo.model}
                      onChange={(e) =>
                        setJobInfo((p) => ({ ...p, model: e.target.value }))
                      }
                      placeholder="e.g. RB5154 Clubmaster"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="oma-wrapang" label="Wrap angle (°)" field="WRAPANG" />
                    <input
                      id="oma-wrapang"
                      type="number"
                      step="0.1"
                      value={jobInfo.wrapang}
                      onChange={(e) =>
                        setJobInfo((p) => ({ ...p, wrapang: e.target.value }))
                      }
                      placeholder="e.g. 5.0"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="oma-panto" label="Pantoscopic tilt (°)" field="PANTO" />
                    <input
                      id="oma-panto"
                      type="number"
                      step="0.1"
                      value={jobInfo.panto}
                      onChange={(e) =>
                        setJobInfo((p) => ({ ...p, panto: e.target.value }))
                      }
                      placeholder="e.g. 8.0"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4 pt-5">
                {showStatusBox && (
                  <div className="rounded-md border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {phase === "complete" ? (
                            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
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

                {trace && (
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold">Drill records</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {drillRecords.length > 0
                            ? `${drillRecords.length} record${drillRecords.length !== 1 ? "s" : ""}`
                            : "No drill records added."}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDrillDialogOpen(true)}
                      >
                        Edit
                      </Button>
                    </div>

                    {invalidDrillRecordIds.size > 0 && (
                      <Alert variant="destructive" className="mt-3 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 py-2">
                        <AlertCircle className="mt-0.5 h-4 w-4" />
                        <AlertTitle className="mb-0 text-sm">Check drill placement</AlertTitle>
                        <AlertDescription className="col-start-2 text-xs">
                          One or more holes appear outside the lens outline or have an invalid diameter.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {primaryOma && (
                    <div className="space-y-1">
                      <label
                        htmlFor="oma-job"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        File name
                      </label>
                      <input
                        id="oma-job"
                        value={jobInfo.job}
                        onChange={(e) =>
                          setJobInfo((p) => ({ ...p, job: e.target.value }))
                        }
                        className="w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs"
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Saved as <span className="font-mono">{jobInfo.job}_400.oma</span>
                      </p>
                    </div>
                  )}
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
                  onClick={() => setCalOpen((o) => !o)}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${calOpen ? "" : "-rotate-90"}`}
                  />
                  <div>
                    <CardTitle>Screen scale</CardTitle>
                    <CardDescription className="mt-1">
                      {pxPerMm
                        ? `Calibrated (${pxPerMm.toFixed(3)} px/mm)`
                        : "Not calibrated — 1:1 view disabled"}
                    </CardDescription>
                  </div>
                </button>
              </CardHeader>
              {calOpen && (
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Measure the line below with a physical ruler and enter its
                    length to enable the 1:1 preview.
                  </p>
                  <div className="flex flex-col items-start gap-1">
                    <div
                      style={{ width: `${CAL_REF_PX}px`, height: "6px" }}
                      className="rounded-full bg-primary"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {CAL_REF_PX} px reference line
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="cal-cm"
                      className="text-sm font-medium"
                    >
                      Line length (mm)
                    </label>
                    <input
                      id="cal-cm"
                      type="number"
                      step="0.01"
                      min="0.1"
                      value={calDraft}
                      onChange={(e) => setCalDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveCalibration();
                      }}
                      placeholder="e.g. 53"
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                    />
                  </div>
                  <Button
                    onClick={saveCalibration}
                    disabled={!calDraft || parseFloat(calDraft) <= 0}
                    className="w-full"
                  >
                    Save
                  </Button>
                </CardContent>
              )}
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
                  <div className="h-[320px] overflow-auto rounded-md border bg-[hsl(var(--log-background))] p-3 font-mono text-xs text-[hsl(var(--log-foreground))]">
                    {logs.length === 0 ? (
                      <div className="text-[hsl(var(--log-muted))]">
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

      {drillDialogOpen && trace && (
        <DrillDialog
          trace={trace}
          initialRecords={drillRecords}
          pxPerMm={pxPerMm}
          onSave={(records) => {
            setDrillRecords(records);
            setDrillDialogOpen(false);
          }}
          onCancel={() => setDrillDialogOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function SettingsDialog({
  theme,
  onThemeChange,
  onClose,
}: {
  theme: ThemeMode;
  onThemeChange: (value: ThemeMode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--overlay)/0.56)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="settings-title" className="text-sm font-semibold">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Appearance</div>
              <div className="text-xs text-muted-foreground">
                Choose how the interface is displayed.
              </div>
            </div>
            <ThemeSelect value={theme} onChange={onThemeChange} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeSelect({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}) {
  return (
    <div className="relative min-w-36">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ThemeMode)}
        className="h-9 w-full appearance-none rounded-md border bg-background px-3 pr-8 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Appearance theme"
      >
        {THEME_OPTIONS.map(({ value: optionValue, label }) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
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


function formatByteHead(bytes: Uint8Array, count: number) {
  return Array.from(bytes.slice(0, count))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function FieldLabel({ htmlFor, label, field }: { htmlFor: string; label: string; field: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-sm font-medium">
      <span>{label}</span>
      <span className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">{field}</span>
    </label>
  );
}

function NumericInput({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatInputNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatInputNumber(value));
  }, [focused, value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isCompleteNumber(next)) onValueChange(Number(next));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(formatInputNumber(value));
      }}
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
    />
  );
}

function formatInputNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function isCompleteNumber(value: string) {
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim());
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function logClassName(level: SerialLogEntry["level"]) {
  switch (level) {
    case "rx":
      return "text-[hsl(var(--log-rx))]";
    case "tx":
      return "text-[hsl(var(--log-tx))]";
    case "warning":
      return "text-[hsl(var(--log-warning))]";
    case "error":
      return "text-[hsl(var(--log-error))]";
    default:
      return "text-[hsl(var(--log-foreground))]";
  }
}
