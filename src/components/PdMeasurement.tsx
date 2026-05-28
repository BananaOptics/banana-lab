import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Point, measurePdMm } from "@/lib/homography";

type Step =
  | "capture"
  | "card-corners"
  | "fine-corners"
  | "tap-eyes"
  | "fine-left"
  | "fine-right"
  | "result";

const STEP_LABELS: Record<Step, string> = {
  capture: "Take Photo",
  "card-corners": "Align Card",
  "fine-corners": "Fine-Tune Card",
  "tap-eyes": "Tap Both Eyes",
  "fine-left": "Left Pupil",
  "fine-right": "Right Pupil",
  result: "Result",
};

const STEP_HINTS: Record<Step, string> = {
  capture: "Hold a credit card on your forehead, centered. Look into the camera.",
  "card-corners": "Drag the four corners to match your credit card.",
  "fine-corners": "Fine-tune each corner. Drag to adjust precisely.",
  "tap-eyes": "Tap approximately on your left eye, then right eye.",
  "fine-left": "Drag the image to center your left pupil in the crosshair.",
  "fine-right": "Drag the image to center your right pupil in the crosshair.",
  result: "",
};

const STEPS: Step[] = [
  "capture",
  "card-corners",
  "fine-corners",
  "tap-eyes",
  "fine-left",
  "fine-right",
  "result",
];

const HANDLE_RADIUS = 14;
const CROSSHAIR_RADIUS = 20;

export function PdMeasurement() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number>(0);

  const [step, setStep] = useState<Step>("capture");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(1);

  const ZOOM_LEVELS = [1, 2, 3] as const;

  // Card corners: TL, TR, BR, BL in image coordinates
  const [cardCorners, setCardCorners] = useState<[Point, Point, Point, Point]>([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);

  // Eye taps (rough positions in image coords)
  const [eyeTaps, setEyeTaps] = useState<Point[]>([]);

  // Fine pupil positions in image coords
  const [leftPupil, setLeftPupil] = useState<Point>({ x: 0, y: 0 });
  const [rightPupil, setRightPupil] = useState<Point>({ x: 0, y: 0 });

  const [pdResult, setPdResult] = useState<number | null>(null);
  const [fineCornerZoom, setFineCornerZoom] = useState(2);
  const FINE_CORNER_ZOOMS = [1, 2, 3, 4] as const;

  // Drag state
  const [dragging, setDragging] = useState<{
    type: "corner" | "pan";
    index: number;
  } | null>(null);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });

  // Image dimensions
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Canvas display transform state
  const transformRef = useRef({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const canvasToImage = useCallback(
    (canvasX: number, canvasY: number): Point => {
      const t = transformRef.current;
      return {
        x: (canvasX - t.offsetX) / t.scale,
        y: (canvasY - t.offsetY) / t.scale,
      };
    },
    [],
  );

  const imageToCanvas = useCallback((imgX: number, imgY: number): Point => {
    const t = transformRef.current;
    return {
      x: imgX * t.scale + t.offsetX,
      y: imgY * t.scale + t.offsetY,
    };
  }, []);

  // --- Camera ---

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      videoRef.current = video;
      setCameraReady(true);
      setCameraError(null);
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : "Could not access camera",
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    setCameraReady(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Crop to the visible zoom region
    const cropW = vw / cameraZoom;
    const cropH = vh / cameraZoom;
    const cropX = (vw - cropW) / 2;
    const cropY = (vh - cropH) / 2;

    const outW = Math.round(cropW);
    const outH = Math.round(cropH);

    const offscreen = document.createElement("canvas");
    offscreen.width = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext("2d")!;
    // Mirror horizontally so the selfie looks natural
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImgSize({ w: img.width, h: img.height });
      stopCamera();

      // Initialize card corners to a centered rectangle
      const cx = img.width / 2;
      const cy = img.height * 0.3;
      const hw = img.width * 0.18;
      const hh = hw * (53.98 / 85.6);
      setCardCorners([
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx + hw, y: cy + hh },
        { x: cx - hw, y: cy + hh },
      ]);

      setStep("card-corners");
    };
    img.src = offscreen.toDataURL("image/jpeg", 0.95);
  }, [stopCamera, cameraZoom]);

  // Start camera on mount
  useEffect(() => {
    if (step === "capture") {
      startCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Compute zoom transform for current step ---

  const computeTransform = useCallback(
    (canvasW: number, canvasH: number) => {
      if (!imageRef.current) return;
      const iw = imgSize.w;
      const ih = imgSize.h;
      if (iw === 0 || ih === 0) return;

      if (step === "card-corners" || step === "tap-eyes") {
        // Fit entire image
        const scale = Math.min(canvasW / iw, canvasH / ih);
        transformRef.current = {
          scale,
          offsetX: (canvasW - iw * scale) / 2,
          offsetY: (canvasH - ih * scale) / 2,
        };
      } else if (step === "fine-corners") {
        // Fit-based zoom centered on the card
        const baseScale = Math.min(canvasW / iw, canvasH / ih);
        const scale = baseScale * fineCornerZoom;
        const centerX = cardCorners.reduce((s, c) => s + c.x, 0) / 4;
        const centerY = cardCorners.reduce((s, c) => s + c.y, 0) / 4;
        transformRef.current = {
          scale,
          offsetX: canvasW / 2 - centerX * scale,
          offsetY: canvasH / 2 - centerY * scale,
        };
      } else if (step === "fine-left" || step === "fine-right") {
        // Zoom into the eye region, centered on current pupil position
        const pupilPoint = step === "fine-left" ? leftPupil : rightPupil;

        // Show a region ~15% of image width around the pupil
        const regionW = iw * 0.15;
        const scale = canvasW / regionW;

        transformRef.current = {
          scale,
          offsetX: canvasW / 2 - pupilPoint.x * scale,
          offsetY: canvasH / 2 - pupilPoint.y * scale,
        };
      } else if (step === "result") {
        // Fit entire image
        const scale = Math.min(canvasW / iw, canvasH / ih);
        transformRef.current = {
          scale,
          offsetX: (canvasW - iw * scale) / 2,
          offsetY: (canvasH - ih * scale) / 2,
        };
      }
    },
    [step, imgSize, eyeTaps, cardCorners, fineCornerZoom, leftPupil, rightPupil],
  );

  // --- Drawing ---

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (step === "capture") {
      // Draw live video feed (mirrored) with zoom
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const baseScale = Math.min(w / vw, h / vh);
        const scale = baseScale * cameraZoom;
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, dw, dh);
        ctx.restore();

        // Face oval guide
        const ovalW = Math.min(w, h) * 0.32;
        const ovalH = ovalW * 1.4;
        const ovalCx = w / 2;
        const ovalCy = h * 0.48;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ovalCx, ovalCy, ovalW, ovalH, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Oval label
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Align face in oval", ovalCx, ovalCy + ovalH + 24);

        // Card guide (above the oval, on forehead area)
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 6]);
        const guideW = ovalW * 1.12;
        const guideH = guideW * (53.98 / 85.6);
        const gx = ovalCx - guideW / 2;
        const gy = ovalCy - ovalH * 0.64;
        ctx.strokeRect(gx, gy, guideW, guideH);
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Place card on forehead", ovalCx, gy - 10);
      }
      return;
    }

    const img = imageRef.current;
    if (!img) return;

    computeTransform(w, h);
    const t = transformRef.current;

    // Draw image
    ctx.save();
    ctx.translate(t.offsetX, t.offsetY);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    if (step === "card-corners" || step === "fine-corners") {
      drawCardOverlay(ctx, cardCorners);
    } else if (step === "tap-eyes") {
      // Show card overlay (locked)
      drawCardOverlay(ctx, cardCorners, true);
      // Show tapped eyes
      for (const tap of eyeTaps) {
        const cp = imageToCanvas(tap.x, tap.y);
        drawCrosshair(ctx, cp.x, cp.y, "rgba(0,200,255,0.9)", 12);
      }
    } else if (step === "fine-left" || step === "fine-right") {
      // Crosshair fixed at canvas center; user drags the image underneath
      drawFineCrosshair(ctx, w / 2, h / 2, estimateIrisRadiusPx());
    } else if (step === "result" && pdResult !== null) {
      // Draw line between pupils
      const lp = imageToCanvas(leftPupil.x, leftPupil.y);
      const rp = imageToCanvas(rightPupil.x, rightPupil.y);
      drawCrosshair(ctx, lp.x, lp.y, "#00ff88", 10);
      drawCrosshair(ctx, rp.x, rp.y, "#00ff88", 10);
      ctx.beginPath();
      ctx.moveTo(lp.x, lp.y);
      ctx.lineTo(rp.x, rp.y);
      ctx.strokeStyle = "#00ff88";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Card outline
      drawCardOverlay(ctx, cardCorners, true);
    }
  }, [
    step,
    cameraZoom,
    cardCorners,
    eyeTaps,
    leftPupil,
    rightPupil,
    pdResult,
    computeTransform,
    imageToCanvas,
  ]);

  function drawCardOverlay(
    ctx: CanvasRenderingContext2D,
    corners: [Point, Point, Point, Point],
    locked = false,
  ) {
    const pts = corners.map((c) => imageToCanvas(c.x, c.y));

    // Draw filled semi-transparent quad
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();

    // Draw outline
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = locked ? "rgba(255,255,255,0.4)" : "#ffffff";
    ctx.lineWidth = locked ? 1 : 2;
    ctx.stroke();

    // Draw corner handles
    if (!locked) {
      for (const pt of pts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
    size: number,
  ) {
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    const gap = size * 0.4;
    const arm = size + 8;
    ctx.beginPath();
    // Top
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy - gap);
    // Bottom
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + arm);
    // Left
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx - gap, cy);
    // Right
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** Estimate iris radius in canvas pixels from the card's known width (85.6mm). */
  function estimateIrisRadiusPx(): number {
    const t = transformRef.current;
    // Average card width in image pixels from top and bottom edges
    const topEdgePx = Math.hypot(
      cardCorners[1].x - cardCorners[0].x,
      cardCorners[1].y - cardCorners[0].y,
    );
    const bottomEdgePx = Math.hypot(
      cardCorners[2].x - cardCorners[3].x,
      cardCorners[2].y - cardCorners[3].y,
    );
    const avgWidthPx = (topEdgePx + bottomEdgePx) / 2;
    const pxPerMm = (avgWidthPx * t.scale) / 85.6;
    // Human iris diameter ~11.7mm, add ~10% for "slightly larger than iris"
    return (11.7 / 2) * 1.1 * pxPerMm;
  }

  function drawFineCrosshair(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    irisRadius: number,
  ) {
    const color = "#00ff88";
    // Pupil (~3.5mm), iris, and two outer rings
    const pupilR = irisRadius * 0.3;
    const radii = [pupilR, irisRadius, irisRadius * 1.6, irisRadius * 2.4];

    // Concentric circles with decreasing opacity
    for (let i = 0; i < radii.length; i++) {
      const opacity = 1 - i * 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy, radii[i], 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = i === 1 ? 2 : 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Crosshair lines extending from inner circle to outer
    const inner = pupilR * 0.4;
    const outer = radii[radii.length - 1] + 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outer);
    ctx.lineTo(cx, cy - inner);
    ctx.moveTo(cx, cy + inner);
    ctx.lineTo(cx, cy + outer);
    ctx.moveTo(cx - outer, cy);
    ctx.lineTo(cx - inner, cy);
    ctx.moveTo(cx + inner, cy);
    ctx.lineTo(cx + outer, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Animation loop
  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // --- Pointer events ---

  const getCanvasPos = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos = getCanvasPos(e);

      if (step === "card-corners" || step === "fine-corners") {
        // Check if near a corner handle
        for (let i = 0; i < 4; i++) {
          const cp = imageToCanvas(cardCorners[i].x, cardCorners[i].y);
          const dx = pos.x - cp.x;
          const dy = pos.y - cp.y;
          if (dx * dx + dy * dy < (HANDLE_RADIUS + 10) ** 2) {
            setDragging({ type: "corner", index: i });
            dragOffsetRef.current = { x: dx, y: dy };
            canvasRef.current?.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      if (step === "tap-eyes") {
        const imgPos = canvasToImage(pos.x, pos.y);
        if (eyeTaps.length < 2) {
          setEyeTaps((prev) => {
            const next = [...prev, imgPos];
            if (next.length === 2) {
              // Initialize fine pupil positions at tap locations
              setLeftPupil(next[0]);
              setRightPupil(next[1]);
            }
            return next;
          });
        }
      }

      if (step === "fine-left" || step === "fine-right") {
        setDragging({ type: "pan", index: 0 });
        dragOffsetRef.current = { x: pos.x, y: pos.y };
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
    },
    [step, cardCorners, eyeTaps, leftPupil, rightPupil, getCanvasPos, imageToCanvas, canvasToImage],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging) return;
      const pos = getCanvasPos(e);
      const adjusted = {
        x: pos.x - dragOffsetRef.current.x,
        y: pos.y - dragOffsetRef.current.y,
      };
      const imgPos = canvasToImage(adjusted.x, adjusted.y);

      if (dragging.type === "corner") {
        setCardCorners((prev) => {
          const next = [...prev] as [Point, Point, Point, Point];
          next[dragging.index] = imgPos;
          return next;
        });
      } else if (dragging.type === "pan") {
        // Pan the image: compute pointer delta, move pupil in opposite direction
        const dx = pos.x - dragOffsetRef.current.x;
        const dy = pos.y - dragOffsetRef.current.y;
        dragOffsetRef.current = { x: pos.x, y: pos.y };
        const scale = transformRef.current.scale;
        const setter = step === "fine-left" ? setLeftPupil : setRightPupil;
        setter((prev) => ({ x: prev.x - dx / scale, y: prev.y - dy / scale }));
      }
    },
    [dragging, getCanvasPos, canvasToImage],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (dragging) {
        canvasRef.current?.releasePointerCapture(e.pointerId);
        setDragging(null);
      }
    },
    [dragging],
  );

  // --- Step navigation ---

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx <= 0) return;
    const prevStep = STEPS[idx - 1];

    if (prevStep === "capture") {
      // Reset everything and restart camera
      imageRef.current = null;
      setEyeTaps([]);
      setPdResult(null);
      setStep("capture");
      startCamera();
      return;
    }

    if (prevStep === "tap-eyes") {
      setEyeTaps([]);
    }

    setStep(prevStep);
  }, [step, startCamera]);

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx >= STEPS.length - 1) return;

    const nextStep = STEPS[idx + 1];

    if (nextStep === "result") {
      // Compute PD
      const pd = measurePdMm(cardCorners, leftPupil, rightPupil);
      setPdResult(pd);
    }

    setStep(nextStep);
  }, [step, cardCorners, leftPupil, rightPupil]);

  const startOver = useCallback(() => {
    imageRef.current = null;
    setEyeTaps([]);
    setPdResult(null);
    setStep("capture");
    startCamera();
  }, [startCamera]);

  // Can advance?
  const canAdvance =
    (step === "card-corners") ||
    (step === "fine-corners") ||
    (step === "tap-eyes" && eyeTaps.length === 2) ||
    (step === "fine-left") ||
    (step === "fine-right");

  const stepIndex = STEPS.indexOf(step);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold">PD Measurement</h1>
          {step !== "capture" && step !== "result" && (
            <div className="mt-1 flex gap-1">
              {STEPS.slice(1, -1).map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full ${
                    i <= STEPS.indexOf(step) - 1
                      ? "bg-primary"
                      : "bg-muted"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {STEP_LABELS[step]}
        </span>
      </header>

      {/* Hint bar */}
      {STEP_HINTS[step] && (
        <div className="border-b bg-muted/30 px-4 py-2 text-center text-sm text-muted-foreground">
          {STEP_HINTS[step]}
        </div>
      )}

      {/* Canvas area */}
      <div ref={containerRef} className="relative flex-1 bg-black">
        {step === "capture" && cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="rounded-lg bg-card p-6 text-center text-sm text-destructive shadow-lg">
              <p className="font-medium">Camera unavailable</p>
              <p className="mt-1 text-muted-foreground">{cameraError}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={startCamera}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {step === "result" && pdResult !== null && (
          <div className="absolute inset-x-0 top-4 z-10 flex justify-center">
            <div className="rounded-xl bg-card/90 px-8 py-5 text-center shadow-2xl backdrop-blur-sm">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pupillary Distance
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums">
                {pdResult.toFixed(1)} mm
              </div>
            </div>
          </div>
        )}

        {step === "fine-corners" && (
          <div className="absolute bottom-3 inset-x-0 z-10 flex justify-center">
            <div className="flex items-center gap-1 rounded-full bg-black/50 px-1 py-0.5 backdrop-blur-sm">
              {FINE_CORNER_ZOOMS.map((z) => (
                <button
                  key={z}
                  onClick={() => setFineCornerZoom(z)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    fineCornerZoom === z
                      ? "bg-white text-black"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {z}x
                </button>
              ))}
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      {/* Bottom controls */}
      <footer className="flex items-center justify-between gap-3 border-t bg-background px-4 py-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}>
        {step === "capture" ? (
          <div className="flex w-full flex-col items-center gap-3">
            {/* Zoom selector */}
            <div className="flex items-center gap-1 rounded-full bg-muted/60 px-1 py-0.5 backdrop-blur-sm">
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  onClick={() => setCameraZoom(z)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    cameraZoom === z
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {z === 1 ? "1x" : z < 1 ? `.${String(z).split(".")[1]}` : `${z}x`}
                </button>
              ))}
            </div>
            <Button
              size="lg"
              className="rounded-full px-8"
              onClick={capturePhoto}
              disabled={!cameraReady}
            >
              <Camera className="mr-2 h-5 w-5" />
              Capture
            </Button>
          </div>
        ) : step === "result" ? (
          <>
            <Button variant="outline" onClick={goBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button variant="outline" onClick={startOver}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Measure Again
            </Button>
            <div />
          </>
        ) : (
          <>
            <Button variant="outline" onClick={goBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={goNext} disabled={!canAdvance}>
              Next
            </Button>
            <div className="w-16 text-right text-xs text-muted-foreground">
              {stepIndex}/{STEPS.length - 1}
            </div>
          </>
        )}
      </footer>
    </main>
  );
}
