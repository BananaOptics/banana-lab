import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Cable,
  CheckCircle2,
  ChevronDown,
  Download,
  FileUp,
  Loader2,
  Play,
  PlugZap,
  PenLine,
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
  parseOmaContent,
} from "@/lib/oma";
import {
  createDesignFromTrace,
  DESIGN_HANDOFF_KEY,
  serializeDesign,
} from "@/lib/lens-design-document";
import { buildSimulatedNidekTrace } from "@/lib/simulated-trace";
import {
  formatNumber,
  mirrorClosedRadiiHorizontally,
  pointIsInsideClosedTrace,
} from "@/lib/trace-geometry";
import { cn } from "@/lib/utils";
import {
  type SerialLogEntry,
  WebSerialTransport,
} from "@/lib/web-serial-transport";
import bananaLabLogoUrl from "@/assets/banana-lab-logo.png";

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
type WorkflowMode = "capture" | "editor";
type DocumentSource =
  | { type: "none" }
  | { type: "tracer"; label?: string }
  | { type: "oma"; label: string };

export function App() {
  const navigate = useNavigate();
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
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    return theme === "dark" || (theme === "system" && media.matches);
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
  const [captureDialogOpen, setCaptureDialogOpen] = useState(false);
  const [workflow, setWorkflow] = useState<WorkflowMode>("capture");
  const [documentSource, setDocumentSource] = useState<DocumentSource>({
    type: "none",
  });
  const [omaWarnings, setOmaWarnings] = useState<string[]>([]);
  const [omaDragActive, setOmaDragActive] = useState(false);
  const [trace, setTrace] = useState<DecodedNidekTrace | null>(null);
  const [showAsPair, setShowAsPair] = useState(false);
  const [pairDblMm, setPairDblMm] = useState(18);
  const [pairDblInput, setPairDblInput] = useState("18");
  const [pairDblTouched, setPairDblTouched] = useState(false);
  const [zoom, setZoom] = useState<"fit" | "1:1">("fit");
  const [pxPerMm, setPxPerMm] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(PXPERMM_KEY);
      return v ? parseFloat(v) : null;
    } catch {
      return null;
    }
  });
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
  const previewTrace = useMemo(() => {
    if (!trace) return null;

    const metadata = {
      ...trace.metadata,
      dblMm: pairDblMm,
      centerDistanceMm: trace.stats.hboxMm + pairDblMm,
    };

    if (trace.metadata.side === "B") {
      return { ...trace, metadata };
    }

    if (!showAsPair) return trace;

    // buildTwoLensPaths always uses radii400 as the right-lens template and mirrors for left.
    // If we captured the left side, mirror first so the geometry comes out correct.
    const radii400 =
      trace.metadata.side === "L"
        ? mirrorClosedRadiiHorizontally(trace.radii400)
        : trace.radii400;
    return { ...trace, radii400, metadata };
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
  const omaFiles = useMemo(() => {
    if (!trace) return [];
    return buildOmaFiles(trace, jobInfo, drillRecords, pairDblMm);
  }, [trace, jobInfo, drillRecords, pairDblMm]);
  const [busy, setBusy] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadPointCount, setDownloadPointCount] = useState<400 | 1000>(400);
  const [frameDetailsExpanded, setFrameDetailsExpanded] = useState(false);
  const transportRef = useRef<WebSerialTransport | null>(null);
  const traceCancelRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const omaFileInputRef = useRef<HTMLInputElement>(null);
  const omaDragDepthRef = useRef(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const useDark = theme === "dark" || (theme === "system" && media.matches);
      setIsDarkTheme(useDark);
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
  const selectedOma = downloadPointCount === 400 ? primaryOma : secondaryOma;
  const logoUrl = bananaLabLogoUrl;

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
    if (trace) setCaptureDialogOpen(false);
  }, [trace]);

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
      if (
        event.altKey &&
        event.shiftKey &&
        (event.code === "KeyR" || event.key.toLowerCase() === "r")
      ) {
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

  const setEditableDblFromTrace = (nextTrace: DecodedNidekTrace) => {
    const dbl = nextTrace.metadata.dblMm > 0 ? nextTrace.metadata.dblMm : 18;
    setPairDblMm(dbl);
    setPairDblInput(String(dbl));
    setPairDblTouched(false);
  };

  const updateEditableDbl = (value: string) => {
    setPairDblTouched(true);
    setPairDblInput(value);
    const n = parseFloat(value);
    if (Number.isFinite(n) && n >= 0) setPairDblMm(n);
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

  const cancelTrace = () => {
    traceCancelRef.current?.abort();
  };

  const startTrace = async () => {
    const transport = transportRef.current;
    if (!transport) return;
    const controller = new AbortController();
    traceCancelRef.current = controller;
    setBusy(true);
    setError(null);
    setTrace(null);
    setShowAsPair(false);
    setDrillRecords([]);
    setDocumentSource({ type: "none" });
    setOmaWarnings([]);
    setProgress(0);
    setPhase("handshake");
    setStatusText("Starting trace read sequence.");
    try {
      const result = await readLt900Trace(transport, {
        onEvent: (event) => handleProtocolEvent(event),
        signal: controller.signal,
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
      setEditableDblFromTrace(result.trace);
      setTrace(result.trace);
      setShowAsPair(result.trace.metadata.side !== "B");
      setDocumentSource({ type: "tracer" });
      setWorkflow("editor");
    } catch (traceError) {
      if (traceError instanceof DOMException && traceError.name === "AbortError") {
        setPhase("idle");
        setProgress(0);
        setStatusText("Trace cancelled.");
      } else {
        const message = messageFromError(traceError);
        setError({ title: "Trace failed", message });
        setPhase("error");
        setStatusText(message);
        addLog({ level: "error", message });
      }
    } finally {
      traceCancelRef.current = null;
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
    setDocumentSource({ type: "none" });
    setOmaWarnings([]);
    setPhase("complete");
    setProgress(100);
    setStatusText("Simulated trace loaded.");
    setJobInfo((prev) => ({ ...prev, job: freshJobName() }));
    setEditableDblFromTrace(simulatedTrace);
    setTrace(simulatedTrace);
    setShowAsPair(simulatedTrace.metadata.side !== "B");
    setDocumentSource({ type: "tracer", label: "Simulated trace" });
    setWorkflow("editor");
    addLog({
      level: "info",
      message: "Decode: Simulated LT-900 trace loaded.",
    });
  };

  const resetTrace = () => {
    setTrace(null);
    setShowAsPair(false);
    setPairDblTouched(false);
    setDrillRecords([]);
    setDocumentSource({ type: "none" });
    setOmaWarnings([]);
    setError(null);
    setPhase("idle");
    setProgress(0);
    setStatusText(connected ? "Ready to start a trace." : "");
    setWorkflow("capture");
  };

  const openOmaFilePicker = () => {
    omaFileInputRef.current?.click();
  };

  const openOmaFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseOmaContent(await file.text(), file.name);
      setTrace(parsed.trace);
      setJobInfo(parsed.jobInfo);
      setDrillRecords(parsed.drillRecords);
      setShowAsPair(parsed.trace.metadata.side !== "B");
      setEditableDblFromTrace(parsed.trace);
      setDocumentSource({ type: "oma", label: parsed.fileName });
      setOmaWarnings(parsed.warnings);
      setPhase("complete");
      setProgress(100);
      setStatusText(`Opened ${parsed.fileName}.`);
      setWorkflow("editor");
    } catch (openError) {
      const message = messageFromError(openError);
      setError({ title: "Could not open OMA", message });
      setStatusText(message);
    } finally {
      setBusy(false);
    }
  };

  const handleOmaFileSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    await openOmaFile(file);
  };

  const handleOmaDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    omaDragDepthRef.current += 1;
    setOmaDragActive(true);
  };

  const handleOmaDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!busy) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleOmaDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    omaDragDepthRef.current = Math.max(0, omaDragDepthRef.current - 1);
    if (omaDragDepthRef.current === 0) {
      setOmaDragActive(false);
    }
  };

  const handleOmaDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    omaDragDepthRef.current = 0;
    setOmaDragActive(false);

    if (busy) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".oma")) {
      const message = "Drop an .oma file to open it.";
      setError({ title: "Could not open OMA", message });
      setStatusText(message);
      return;
    }

    await openOmaFile(file);
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
    if (
      documentSource.type === "tracer" &&
      !pairDblTouched &&
      !window.confirm(
        "DBL has not been checked or edited since tracing. Download the OMA file anyway?",
      )
    ) {
      return false;
    }

    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    return true;
  };

  const openCurrentTraceInDesigner = () => {
    if (!trace) return;
    const design = createDesignFromTrace(trace, {
      fileName:
        documentSource.type === "oma"
          ? documentSource.label
          : documentSource.type === "tracer"
            ? documentSource.label ?? "Captured trace"
            : "Captured trace",
      jobInfo,
      drillRecords,
      dblMm: pairDblMm,
    });
    sessionStorage.setItem(DESIGN_HANDOFF_KEY, serializeDesign(design));
    navigate("/designer");
  };

  const saveCalibration = () => {
    const mm = parseFloat(calDraft);
    if (isNaN(mm) || mm <= 0) return;
    const px = CAL_REF_PX / mm;
    setPxPerMm(px);
    try {
      localStorage.setItem(PXPERMM_KEY, String(px));
    } catch {
      /* ignore */
    }
  };

  const isActivePhase =
    phase !== "idle" && phase !== "complete" && phase !== "error";
  const showReset = trace !== null || error !== null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1>
                <img
                  src={logoUrl}
                  alt="Banana Optics"
                  className="h-11 w-auto"
                />
              </h1>
              {workflow === "capture" ? (
                <Badge variant={connected ? "success" : "secondary"}>
                  {connected ? "Connected" : "Disconnected"}
                </Badge>
              ) : documentSource.type !== "tracer" || documentSource.label ? (
                <Badge
                  variant={
                    documentSource.type === "oma" ? "secondary" : "success"
                  }
                >
                  {documentSource.type === "oma"
                    ? documentSource.label
                    : documentSource.type === "tracer"
                      ? documentSource.label
                      : "OMA draft"}
                </Badge>
              ) : null}
            </div>
            {trace && workflow === "capture" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="tracer-model"
                    className="text-xs font-medium text-muted-foreground whitespace-nowrap"
                  >
                    Tracer model
                  </label>
                  <select
                    id="tracer-model"
                    value={tracerModel}
                    onChange={(e) =>
                      setTracerModel(e.target.value as TracerModel)
                    }
                    disabled={connected}
                    className="rounded-md border bg-background px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {TRACER_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={omaFileInputRef}
              type="file"
              accept=".oma,.OMA,text/plain"
              className="hidden"
              onChange={handleOmaFileSelected}
            />
            <Button
              variant="outline"
              onClick={() => navigate("/designer")}
              disabled={busy}
            >
              <PenLine className="h-4 w-4" />
              Designer
            </Button>
            {trace && (
              <Button
                variant="outline"
                onClick={openOmaFilePicker}
                disabled={busy}
              >
                <FileUp className="h-4 w-4" />
                Open OMA
              </Button>
            )}
            {trace && workflow === "capture" && (
              <>
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
                    <Button
                      variant="outline"
                      onClick={disconnect}
                      disabled={busy}
                    >
                      <Unplug className="h-4 w-4" />
                      Disconnect
                    </Button>
                  </div>
                )}
                {busy && phase !== "idle" ? (
                  <Button variant="outline" onClick={cancelTrace}>
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={startTrace} disabled={!connected || busy}>
                    <Play className="h-4 w-4" />
                    Read trace
                  </Button>
                )}
              </>
            )}
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
            {trace && workflow === "capture" && !connected && (
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

        {error && !captureDialogOpen ? (
          <Alert
            variant="destructive"
            className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1"
          >
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <AlertTitle className="mb-0">{error.title}</AlertTitle>
            <AlertDescription className="col-start-2">
              {error.message}
            </AlertDescription>
          </Alert>
        ) : null}

        {workflow === "capture" && !serialSupported ? (
          <Alert className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <AlertTitle className="mb-0">Tracer capture unavailable</AlertTitle>
            <AlertDescription className="col-start-2">
              Web Serial requires desktop Chrome or Edge. Opening and editing
              OMA files is still available.
            </AlertDescription>
          </Alert>
        ) : null}

        {workflow === "editor" && omaWarnings.length > 0 ? (
          <Alert className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <AlertTitle className="mb-0">OMA compatibility note</AlertTitle>
            <AlertDescription className="col-start-2">
              {omaWarnings.join(" ")}
            </AlertDescription>
          </Alert>
        ) : null}

        {!trace ? (
          <section className="flex min-h-[420px] items-center justify-center py-8">
            <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
              <Card className="flex h-full flex-col">
                <CardHeader className="sm:min-h-[96px]">
                  <CardTitle>Trace form</CardTitle>
                  <CardDescription>Trace with physical tracer.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <div className="flex min-h-[210px] flex-1 flex-col items-center justify-between gap-5 p-5">
                    <Cable
                      className="h-[120px] w-[120px] text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Button
                      className="w-full"
                      onClick={() => {
                        setWorkflow("capture");
                        setCaptureDialogOpen(true);
                      }}
                    >
                      Trace form
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card
                className={cn(
                  "flex h-full flex-col transition-colors",
                  busy && "opacity-70",
                )}
                onDragEnter={handleOmaDragEnter}
                onDragLeave={handleOmaDragLeave}
                onDragOver={handleOmaDragOver}
                onDrop={handleOmaDrop}
              >
                <CardHeader className="sm:min-h-[96px]">
                  <CardTitle>From file</CardTitle>
                  <CardDescription>
                    Open or drop an existing OMA file and continue editing it.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <div
                    className={cn(
                      "flex min-h-[210px] flex-1 flex-col items-center justify-between gap-5 rounded-md border-2 border-dotted border-muted-foreground/50 bg-muted/20 p-5 transition-colors",
                      omaDragActive &&
                        "border-ring bg-accent/60 ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                  >
                    <FileUp
                      className="h-[120px] w-[120px] text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Button
                      className="w-full"
                      onClick={openOmaFilePicker}
                      disabled={busy}
                    >
                      Open OMA
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        ) : (
          <>
            {workflow === "editor" && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={openCurrentTraceInDesigner}>
                  <PenLine className="h-4 w-4" />
                  Open in designer
                </Button>
                <div className="relative" ref={downloadMenuRef}>
                  <Button
                    variant="outline"
                    disabled={!primaryOma && !secondaryOma}
                    onClick={() => setDownloadMenuOpen((o) => !o)}
                    aria-expanded={downloadMenuOpen}
                  >
                    <Download className="h-4 w-4" />
                    Download
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  {downloadMenuOpen && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-[320px] rounded-md border bg-popover p-4 shadow-md">
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label
                            htmlFor="oma-job"
                            className="text-xs font-medium text-muted-foreground"
                          >
                            File name
                          </label>
                          <div className="flex overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                            <input
                              id="oma-job"
                              value={jobInfo.job}
                              onChange={(e) =>
                                setJobInfo((p) => ({
                                  ...p,
                                  job: e.target.value.replace(
                                    /(?:_(?:400|1000))?\.oma$/i,
                                    "",
                                  ),
                                }))
                              }
                              className="min-w-0 flex-1 bg-transparent px-3 py-1.5 font-mono text-xs outline-none"
                              spellCheck={false}
                            />
                            <span className="flex shrink-0 items-center border-l bg-muted px-3 font-mono text-xs text-muted-foreground">
                              .oma
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            OMA points
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="download-point-count"
                              value="400"
                              checked={downloadPointCount === 400}
                              onChange={() => setDownloadPointCount(400)}
                              disabled={!primaryOma}
                            />
                            400
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="download-point-count"
                              value="1000"
                              checked={downloadPointCount === 1000}
                              onChange={() => setDownloadPointCount(1000)}
                              disabled={!secondaryOma}
                            />
                            1000
                          </label>
                        </div>

                        <Button
                          className="w-full"
                          disabled={!selectedOma}
                          onClick={() => {
                            if (selectedOma && downloadOma(selectedOma)) {
                              setDownloadMenuOpen(false);
                            }
                          }}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
                          title={
                            !pxPerMm
                              ? "Calibrate screen scale first"
                              : "True 1:1 physical scale"
                          }
                        >
                          1:1
                        </button>
                      </div>
                      {workflow === "editor" &&
                        trace &&
                        trace.metadata.side !== "B" && (
                          <>
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
                  <CardContent className="space-y-4">
                    <TracePreview
                      trace={previewTrace}
                      drillRecords={drillRecords}
                      invalidDrillRecordIds={invalidDrillRecordIds}
                      isLoading={isActivePhase}
                      zoom={zoom}
                      pxPerMm={pxPerMm}
                    />
                    {workflow === "editor" && trace && (
                      <div className="border-t pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-sm font-semibold">
                              Drill records
                            </h2>
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
                          <Alert
                            variant="destructive"
                            className="mt-3 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 py-2"
                          >
                            <AlertCircle className="mt-0.5 h-4 w-4" />
                            <AlertTitle className="mb-0 text-sm">
                              Check drill placement
                            </AlertTitle>
                            <AlertDescription className="col-start-2 text-xs">
                              One or more holes appear outside the lens outline
                              or have an invalid diameter.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                {workflow === "editor" && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Details</CardTitle>
                        <CardDescription>
                          Frame measurements and metadata written into the OMA
                          file.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4">
                          <div className="space-y-1.5">
                            <FieldLabel
                              htmlFor="frame-dbl"
                              label="Bridge distance"
                              field="DBL"
                            />
                            <div className="relative">
                              <input
                                id="frame-dbl"
                                type="text"
                                inputMode="decimal"
                                value={pairDblInput}
                                onChange={(e) =>
                                  updateEditableDbl(e.target.value)
                                }
                                className="w-full rounded-md border bg-background px-3 py-1.5 pr-10 text-sm"
                              />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                mm
                              </span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel
                              htmlFor="oma-ven"
                              label="Frame brand"
                              field="VEN"
                            />
                            <input
                              id="oma-ven"
                              value={jobInfo.ven}
                              onChange={(e) =>
                                setJobInfo((p) => ({
                                  ...p,
                                  ven: e.target.value,
                                }))
                              }
                              placeholder="e.g. Ray-Ban"
                              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel
                              htmlFor="oma-model"
                              label="Frame model"
                              field="MODEL"
                            />
                            <input
                              id="oma-model"
                              value={jobInfo.model}
                              onChange={(e) =>
                                setJobInfo((p) => ({
                                  ...p,
                                  model: e.target.value,
                                }))
                              }
                              placeholder="e.g. RB5154 Clubmaster"
                              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-fit px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                            onClick={() =>
                              setFrameDetailsExpanded((expanded) => !expanded)
                            }
                            aria-expanded={frameDetailsExpanded}
                            aria-controls="frame-details-extra"
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${frameDetailsExpanded ? "rotate-180" : ""}`}
                            />
                            {frameDetailsExpanded ? "Show less" : "Show more"}
                          </Button>
                          {frameDetailsExpanded && (
                            <div
                              id="frame-details-extra"
                              className="grid gap-4"
                            >
                              {trace && (
                                <>
                                  <FrameReadout
                                    label="Captured side"
                                    field="Side"
                                    value={
                                      {
                                        R: "Right lens",
                                        L: "Left lens",
                                        B: "Both lenses",
                                      }[trace.metadata.side] ??
                                      trace.metadata.side
                                    }
                                  />
                                  <FrameReadout
                                    label="Lens width"
                                    field="HBOX"
                                    value={`${formatNumber(trace.stats.hboxMm, 2)} mm`}
                                  />
                                  <FrameReadout
                                    label="Lens height"
                                    field="VBOX"
                                    value={`${formatNumber(trace.stats.vboxMm, 2)} mm`}
                                  />
                                  <FrameReadout
                                    label="Circumference"
                                    field="CIRC"
                                    value={`${formatNumber(trace.stats.circMm, 2)} mm`}
                                  />
                                  <FrameReadout
                                    label="Base curve"
                                    field="FCRV"
                                    value={formatNumber(trace.metadata.fcrv, 1)}
                                  />
                                </>
                              )}
                              <div className="space-y-1.5">
                                <FieldLabel
                                  htmlFor="oma-wrapang"
                                  label="Wrap angle (deg)"
                                  field="WRAPANG"
                                />
                                <input
                                  id="oma-wrapang"
                                  type="number"
                                  step="0.1"
                                  value={jobInfo.wrapang}
                                  onChange={(e) =>
                                    setJobInfo((p) => ({
                                      ...p,
                                      wrapang: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g. 5.0"
                                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <FieldLabel
                                  htmlFor="oma-panto"
                                  label="Pantoscopic tilt (deg)"
                                  field="PANTO"
                                />
                                <input
                                  id="oma-panto"
                                  type="number"
                                  step="0.1"
                                  value={jobInfo.panto}
                                  onChange={(e) =>
                                    setJobInfo((p) => ({
                                      ...p,
                                      panto: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g. 8.0"
                                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {captureDialogOpen && (
        <CaptureDialog
          tracerModel={tracerModel}
          connected={connected}
          serialSupported={serialSupported}
          busy={busy}
          error={error}
          phase={phase}
          progress={progress}
          statusText={statusText}
          portInfo={portInfo}
          logs={logs}
          logEndRef={logEndRef}
          onTracerModelChange={setTracerModel}
          onConnect={connect}
          onDisconnect={disconnect}
          onReadTrace={startTrace}
          onCancel={cancelTrace}
          onReleasePorts={releasePorts}
          onClearLogs={() => setLogs([])}
          onClose={() => setCaptureDialogOpen(false)}
        />
      )}
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
          pxPerMm={pxPerMm}
          calDraft={calDraft}
          onThemeChange={setTheme}
          onCalDraftChange={setCalDraft}
          onSaveCalibration={saveCalibration}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function CaptureDialog({
  tracerModel,
  connected,
  serialSupported,
  busy,
  error,
  phase,
  progress,
  statusText,
  portInfo,
  logs,
  logEndRef,
  onTracerModelChange,
  onConnect,
  onDisconnect,
  onReadTrace,
  onCancel,
  onReleasePorts,
  onClearLogs,
  onClose,
}: {
  tracerModel: TracerModel;
  connected: boolean;
  serialSupported: boolean;
  busy: boolean;
  error: AppError | null;
  phase: Lt900Phase;
  progress: number;
  statusText: string;
  portInfo: string | null;
  logs: UiLogEntry[];
  logEndRef: RefObject<HTMLDivElement>;
  onTracerModelChange: (value: TracerModel) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onReadTrace: () => void;
  onCancel: () => void;
  onReleasePorts: () => void;
  onClearLogs: () => void;
  onClose: () => void;
}) {
  const isActive =
    phase !== "idle" && phase !== "complete" && phase !== "error";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isActive) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--overlay)/0.56)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isActive) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-lg border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="capture-title" className="text-sm font-semibold">
            Trace form
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isActive}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close trace form"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-5">
          {error && (
            <Alert
              variant="destructive"
              className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1"
            >
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <AlertTitle className="mb-0">{error.title}</AlertTitle>
              <AlertDescription className="col-start-2">
                {error.message}
              </AlertDescription>
            </Alert>
          )}

          {!serialSupported && (
            <Alert className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <AlertTitle className="mb-0">
                Tracer capture unavailable
              </AlertTitle>
              <AlertDescription className="col-start-2">
                Web Serial requires desktop Chrome or Edge.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="dialog-tracer-model"
              className="text-sm font-medium"
            >
              Tracer model
            </label>
            <div className="relative">
              <select
                id="dialog-tracer-model"
                value={tracerModel}
                onChange={(e) =>
                  onTracerModelChange(e.target.value as TracerModel)
                }
                disabled={connected}
                className="h-9 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {TRACER_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {phase === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                ) : (
                  <PlugZap className="h-4 w-4 text-muted-foreground" />
                )}
                {connected ? phaseLabels[phase] : "Disconnected"}
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {progress}%
              </span>
            </div>
            <Progress value={progress} className="mt-3" />
            <p className="mt-3 text-sm text-muted-foreground">
              {statusText ||
                (connected
                  ? "Serial port connected. Ready to read a trace."
                  : "Connect a tracer to begin.")}
            </p>
            {portInfo && (
              <p className="mt-2 text-xs text-muted-foreground">{portInfo}</p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {!connected ? (
              <Button
                onClick={onConnect}
                disabled={!serialSupported || busy}
                className="flex-1"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cable className="h-4 w-4" />
                )}
                Connect tracer
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={onDisconnect}
                disabled={busy}
                className="flex-1"
              >
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            )}
            {busy && phase !== "idle" ? (
              <Button
                variant="outline"
                onClick={onCancel}
                className="flex-1"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            ) : (
              <Button
                onClick={onReadTrace}
                disabled={!connected || busy}
                className="flex-1"
              >
                <Play className="h-4 w-4" />
                Read trace
              </Button>
            )}
          </div>

          {!connected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReleasePorts}
              disabled={!serialSupported || busy}
              className="w-full text-muted-foreground"
            >
              <Unplug className="h-3.5 w-3.5" />
              Release ports
            </Button>
          )}

          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Protocol Log</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Recent host and tracer messages.
                </p>
              </div>
              {logs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearLogs}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
            <div className="h-[240px] overflow-auto rounded-md border bg-[hsl(var(--log-background))] p-3 font-mono text-xs text-[hsl(var(--log-foreground))]">
              {logs.length === 0 ? (
                <div className="text-[hsl(var(--log-muted))]">
                  No serial activity yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((entry) => (
                    <div key={entry.id} className={logClassName(entry.level)}>
                      {entry.message}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({
  theme,
  pxPerMm,
  calDraft,
  onThemeChange,
  onCalDraftChange,
  onSaveCalibration,
  onClose,
}: {
  theme: ThemeMode;
  pxPerMm: number | null;
  calDraft: string;
  onThemeChange: (value: ThemeMode) => void;
  onCalDraftChange: (value: string) => void;
  onSaveCalibration: () => void;
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
          <div className="border-t pt-5">
            <div className="mb-3">
              <div className="text-sm font-medium">Screen scale</div>
              <div className="text-xs text-muted-foreground">
                {pxPerMm
                  ? `Calibrated (${pxPerMm.toFixed(3)} px/mm)`
                  : "Not calibrated - 1:1 view disabled"}
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Measure the line below with a physical ruler and enter its
                length to enable the 1:1 preview.
              </p>
              <div className="flex flex-col items-start gap-1">
                <div
                  style={{ width: `${CAL_REF_PX}px`, height: "6px" }}
                  className="max-w-full rounded-full bg-primary"
                />
                <span className="text-[10px] text-muted-foreground">
                  {CAL_REF_PX} px reference line
                </span>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cal-mm" className="text-sm font-medium">
                  Line length (mm)
                </label>
                <div className="flex gap-2">
                  <input
                    id="cal-mm"
                    type="number"
                    step="0.01"
                    min="0.1"
                    value={calDraft}
                    onChange={(e) => onCalDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSaveCalibration();
                    }}
                    placeholder="e.g. 53"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground"
                  />
                  <Button
                    onClick={onSaveCalibration}
                    disabled={!calDraft || parseFloat(calDraft) <= 0}
                    className="shrink-0"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t px-5 py-4">
          <Button type="button" onClick={onClose}>
            Close
          </Button>
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

function FieldLabel({
  htmlFor,
  label,
  field,
}: {
  htmlFor: string;
  label: string;
  field: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex items-baseline justify-between gap-2 text-sm font-medium"
    >
      <span>{label}</span>
      <span className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
        {field}
      </span>
    </label>
  );
}

function FrameReadout({
  label,
  field,
  value,
}: {
  label: string;
  field: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm font-medium">
        <span>{label}</span>
        <span className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
          {field}
        </span>
      </div>
      <div className="rounded-md border bg-muted/30 px-3 py-1.5 text-sm font-medium text-muted-foreground">
        {value}
      </div>
    </div>
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
