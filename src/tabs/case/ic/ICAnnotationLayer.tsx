import { useRef, useState, useEffect, useCallback } from "react";

// ── Annotation types ──────────────────────────────────────────────────────────

export type PenStroke    = { id: string; type: "pen";       color: string; width: number; d: string };
export type HighlightBox = { id: string; type: "highlight"; color: string; x: number; y: number; w: number; h: number };
export type TextNote     = { id: string; type: "text";      color: string; x: number; y: number; text: string };
export type Annotation   = PenStroke | HighlightBox | TextNote;
export type DrawTool     = "pen" | "highlight" | "text" | "eraser";

// ── Helper: export annotations as SVG string ──────────────────────────────────

export function annotationsToSvgString(annotations: Annotation[], width: number, height: number): string {
  const inner = annotations.map(ann => {
    if (ann.type === "pen") {
      return `<path d="${ann.d}" stroke="${ann.color}" stroke-width="${ann.width}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
    }
    if (ann.type === "highlight") {
      return `<rect x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" fill="${ann.color}" opacity="0.28"/>`;
    }
    if (ann.type === "text") {
      return `<text x="${ann.x}" y="${ann.y}" fill="${ann.color}" font-family="'Source Serif 4', Georgia, serif" font-size="13">${ann.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</text>`;
    }
    return "";
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="position:absolute;top:0;left:0;pointer-events:none">${inner}</svg>`;
}

// ── Smoothed SVG path from points ─────────────────────────────────────────────

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// ── Parse 'd' string to extract approximate points ────────────────────────────

function parsePathPoints(d: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const re = /[MQLmql]\s*([-\d.]+)[,\s]+([-\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return pts;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function segmentNearCursor(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, radius: number): boolean {
  const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lenSq === 0) return dist(ax, ay, cx, cy) < radius;
  let t = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(ax + t * (bx - ax), ay + t * (by - ay), cx, cy) < radius;
}

function strokeNearCursor(d: string, cx: number, cy: number, radius: number): boolean {
  const pts = parsePathPoints(d);
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentNearCursor(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, cx, cy, radius)) return true;
  }
  return pts.length === 1 && dist(pts[0].x, pts[0].y, cx, cy) < radius;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  tool: DrawTool;
  color: string;
  strokeWidth: number;
  active: boolean;
  onChange: (annotations: Annotation[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ICAnnotationLayer({ containerRef, annotations, tool, color, strokeWidth, active, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgH, setSvgH] = useState(800);

  // Live drawing state
  const [livePts, setLivePts] = useState<{ x: number; y: number }[]>([]);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number; id: string } | null>(null);
  const [textVal, setTextVal] = useState("");

  const drawing = useRef(false);
  const startPt = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rawPts  = useRef<{ x: number; y: number }[]>([]);

  // Track scroll container height via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setSvgH(el.scrollHeight);
    });
    obs.observe(el);
    setSvgH(el.scrollHeight);
    return () => obs.disconnect();
  }, [containerRef]);

  const getCoords = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // ── Pointer down ────────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!active || tool === "text") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const pt = getCoords(e);
    startPt.current = pt;
    rawPts.current = [pt];
    if (tool === "pen") setLivePts([pt]);
    if (tool === "highlight") setLiveRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }, [active, tool, getCoords]);

  // ── Pointer move ────────────────────────────────────────────────────────────

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    const pt = getCoords(e);

    if (tool === "eraser" && (e.buttons === 1 || e.pressure > 0)) {
      const radius = 24;
      const next = annotations.filter(ann => {
        if (ann.type === "pen") return !strokeNearCursor(ann.d, pt.x, pt.y, radius);
        if (ann.type === "highlight") {
          const cx = ann.x + ann.w / 2;
          const cy = ann.y + ann.h / 2;
          return dist(cx, cy, pt.x, pt.y) >= radius + Math.max(ann.w, ann.h) / 2;
        }
        if (ann.type === "text") return dist(ann.x, ann.y, pt.x, pt.y) >= radius;
        return true;
      });
      if (next.length !== annotations.length) onChange(next);
      return;
    }

    if (!drawing.current) return;

    if (tool === "pen") {
      rawPts.current.push(pt);
      setLivePts([...rawPts.current]);
    }
    if (tool === "highlight") {
      const sp = startPt.current;
      setLiveRect({
        x: Math.min(sp.x, pt.x),
        y: Math.min(sp.y, pt.y),
        w: Math.abs(pt.x - sp.x),
        h: Math.abs(pt.y - sp.y),
      });
    }
  }, [active, tool, annotations, onChange, getCoords]);

  // ── Pointer up ──────────────────────────────────────────────────────────────

  const onPointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;

    if (tool === "pen" && rawPts.current.length > 0) {
      const d = buildSmoothPath(rawPts.current);
      if (d) {
        onChange([...annotations, { id: uid(), type: "pen", color, width: strokeWidth, d }]);
      }
      setLivePts([]);
      rawPts.current = [];
    }

    if (tool === "highlight" && liveRect) {
      if (liveRect.w > 10 && liveRect.h > 10) {
        onChange([...annotations, { id: uid(), type: "highlight", color, ...liveRect }]);
      }
      setLiveRect(null);
    }
  }, [tool, annotations, onChange, color, strokeWidth, liveRect]);

  // ── Click (text tool) ───────────────────────────────────────────────────────

  const onClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!active || tool !== "text") return;
    const pt = getCoords(e);
    setTextInput({ x: pt.x, y: pt.y, id: uid() });
    setTextVal("");
  }, [active, tool, getCoords]);

  const commitText = useCallback(() => {
    if (textInput && textVal.trim()) {
      onChange([...annotations, { id: textInput.id, type: "text", color, x: textInput.x, y: textInput.y, text: textVal.trim() }]);
    }
    setTextInput(null);
    setTextVal("");
  }, [textInput, textVal, annotations, onChange, color]);

  const onTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitText(); }
    if (e.key === "Escape") { setTextInput(null); setTextVal(""); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const livePath = livePts.length > 1 ? buildSmoothPath(livePts) : null;

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: svgH,
        pointerEvents: active ? "all" : "none",
        zIndex: 10,
        touchAction: "pan-y",
        cursor: tool === "pen" ? "crosshair" : tool === "highlight" ? "crosshair" : tool === "text" ? "text" : tool === "eraser" ? "cell" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    >
      {/* Committed annotations */}
      {annotations.map(ann => {
        if (ann.type === "pen") {
          return (
            <path
              key={ann.id}
              d={ann.d}
              stroke={ann.color}
              strokeWidth={ann.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
          );
        }
        if (ann.type === "highlight") {
          return (
            <rect
              key={ann.id}
              x={ann.x}
              y={ann.y}
              width={ann.w}
              height={ann.h}
              fill={ann.color}
              opacity={0.28}
            />
          );
        }
        if (ann.type === "text") {
          return (
            <text
              key={ann.id}
              x={ann.x}
              y={ann.y}
              fill={ann.color}
              fontFamily="'Source Serif 4', Georgia, serif"
              fontSize={13}
            >
              {ann.text}
            </text>
          );
        }
        return null;
      })}

      {/* Live pen stroke preview */}
      {livePath && (
        <path
          d={livePath}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      )}

      {/* Live highlight rect preview */}
      {liveRect && (
        <rect
          x={liveRect.x}
          y={liveRect.y}
          width={liveRect.w}
          height={liveRect.h}
          fill={color}
          opacity={0.28}
        />
      )}

      {/* Text input foreignObject */}
      {textInput && (
        <foreignObject x={textInput.x} y={textInput.y - 16} width={220} height={30}>
          <input
            // @ts-expect-error xmlns is valid on foreignObject children
            xmlns="http://www.w3.org/1999/xhtml"
            autoFocus
            type="text"
            value={textVal}
            onChange={e => setTextVal(e.target.value)}
            onBlur={commitText}
            onKeyDown={onTextKeyDown}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.92)",
              border: `1px solid ${color}`,
              outline: "none",
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontSize: 13,
              color: color,
              padding: "2px 6px",
              borderRadius: 3,
            }}
          />
        </foreignObject>
      )}
    </svg>
  );
}
