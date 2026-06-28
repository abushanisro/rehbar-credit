import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrawTool = "pen" | "highlight" | "text" | "eraser";

export type UserMeta = {
  userId: string;
  userName: string;
  userInitials: string;
  userColor: string;
  createdAt: string;
};

export type UserAnnotation =
  | ({ id: string; type: "pen";       color: string; width: number; d: string; lastX: number; lastY: number } & UserMeta)
  | ({ id: string; type: "highlight"; color: string; x: number; y: number; w: number; h: number }              & UserMeta)
  | ({ id: string; type: "text";      color: string; x: number; y: number; text: string }                      & UserMeta);

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_COLORS = ["#e11d48","#f59e0b","#10b981","#3b82f6","#8b5cf6","#f97316","#06b6d4","#84cc16"];
const PALETTE     = ["#e11d48","#f59e0b","#10b981","#2563eb","#7c3aed","#ea580c","#0891b2","#1f2937"];

function getUserColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) % USER_COLORS.length;
  return USER_COLORS[Math.abs(h)];
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L ${l.x} ${l.y}`;
}

function parsePts(d: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const re = /[MQLmql]\s*([-\d.]+)[,\s]+([-\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  return pts;
}

function dst(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function segNear(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const lsq = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lsq === 0) return dst(ax, ay, cx, cy) < r;
  const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / lsq));
  return dst(ax + t * (bx - ax), ay + t * (by - ay), cx, cy) < r;
}

function strokeNear(d: string, cx: number, cy: number, r: number): boolean {
  const pts = parsePts(d);
  for (let i = 0; i < pts.length - 1; i++)
    if (segNear(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, cx, cy, r)) return true;
  return pts.length === 1 && dst(pts[0].x, pts[0].y, cx, cy) < r;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  userName: string;
  annotations: UserAnnotation[];
  onChange: (a: UserAnnotation[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnnotationOverlay({ userId, userName, annotations, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgH, setSvgH] = useState(3000);

  const [active,      setActive]      = useState(false);
  const [expanded,    setExpanded]    = useState(false);
  const [tool,        setTool]        = useState<DrawTool>("pen");
  const [color,       setColor]       = useState(() => getUserColor(userId));
  const [strokeWidth, setStrokeWidth] = useState(2);

  const [livePts,   setLivePts]   = useState<{ x: number; y: number }[]>([]);
  const [liveRect,  setLiveRect]  = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number; id: string } | null>(null);
  const [textVal,   setTextVal]   = useState("");

  // Refs so event handlers always see current values without stale closures
  const drawing     = useRef(false);
  const startPt     = useRef({ x: 0, y: 0 });
  const rawPts      = useRef<{ x: number; y: number }[]>([]);
  const annRef      = useRef(annotations);  annRef.current      = annotations;
  const onChgRef    = useRef(onChange);     onChgRef.current    = onChange;
  const toolRef     = useRef(tool);         toolRef.current     = tool;
  const colorRef    = useRef(color);        colorRef.current    = color;
  const swRef       = useRef(strokeWidth);  swRef.current       = strokeWidth;
  const liveRectRef = useRef(liveRect);     liveRectRef.current = liveRect;
  const activeRef   = useRef(active);       activeRef.current   = active;

  // ── Position: absolute on body so SVG covers full document height ──────────
  // getBoundingClientRect() then gives correct document-space coords with no
  // scroll tracking or translate-group needed at all.
  useEffect(() => {
    const prev = document.body.style.position;
    if (getComputedStyle(document.body).position === "static") {
      document.body.style.position = "relative";
    }
    return () => { document.body.style.position = prev; };
  }, []);

  // Track document height so SVG always covers all content.
  // IMPORTANT: observe the content element (not body) to avoid circular dependency.
  // The SVG is position:absolute on body → inflates body.scrollHeight → ResizeObserver
  // on body never fires when content shrinks → SVG stays tall forever (blank space).
  // By observing the first non-SVG child of body (the app root div), the observer
  // fires on real content changes independently of the SVG's height.
  useEffect(() => {
    const getH = () => {
      const svg = svgRef.current;
      if (!svg) return document.body.scrollHeight;
      svg.style.height = "0px";
      const h = document.body.scrollHeight;
      svg.style.height = "";   // React controls the rendered value via svgH state
      return h;
    };

    const update = () => setSvgH(getH());
    update();

    // Observe #root (grows with content when body/root have min-height: 100%).
    // Also re-measure on every resize so svgH never stays stale after tab switches.
    const contentEl = document.getElementById("root") ?? document.body;
    const obs = new ResizeObserver(update);
    obs.observe(contentEl);
    window.addEventListener("resize", update);
    return () => { obs.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  // ── Coordinate helper — the only correct way ───────────────────────────────
  // SVG is position:absolute top:0 left:0 → rect.top = -scrollY, rect.left = 0
  // clientX - rect.left = clientX (no horiz shift)
  // clientY - rect.top  = clientY + scrollY = pageY  ← document-space Y
  const getCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const makeMeta = useCallback((): UserMeta => ({
    userId, userName,
    userInitials: getInitials(userName),
    userColor: getUserColor(userId),
    createdAt: new Date().toISOString(),
  }), [userId, userName]);

  // ── Pointer handlers (React synthetic events on the portal SVG) ────────────

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!activeRef.current || toolRef.current === "text") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const pt = getCoords(e);
    startPt.current = pt;
    rawPts.current  = [pt];
    if (toolRef.current === "pen")       setLivePts([pt]);
    if (toolRef.current === "highlight") setLiveRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }, [getCoords]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!activeRef.current) return;
    const pt = getCoords(e);

    if (toolRef.current === "eraser" && (e.buttons === 1 || e.pressure > 0)) {
      const r = 24;
      const next = annRef.current.filter(ann => {
        if (ann.type === "pen")       return !strokeNear(ann.d, pt.x, pt.y, r);
        if (ann.type === "highlight") return dst(ann.x + ann.w / 2, ann.y + ann.h / 2, pt.x, pt.y) >= r + Math.max(ann.w, ann.h) / 2;
        if (ann.type === "text")      return dst(ann.x, ann.y, pt.x, pt.y) >= r;
        return true;
      });
      if (next.length !== annRef.current.length) onChgRef.current(next);
      return;
    }

    if (!drawing.current) return;
    if (toolRef.current === "pen") {
      rawPts.current.push(pt);
      setLivePts([...rawPts.current]);
    }
    if (toolRef.current === "highlight") {
      const sp = startPt.current;
      setLiveRect({ x: Math.min(sp.x, pt.x), y: Math.min(sp.y, pt.y), w: Math.abs(pt.x - sp.x), h: Math.abs(pt.y - sp.y) });
    }
  }, [getCoords]);

  const onPointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;

    if (toolRef.current === "pen" && rawPts.current.length > 0) {
      const d   = smoothPath(rawPts.current);
      const lpt = rawPts.current[rawPts.current.length - 1];
      if (d) {
        onChgRef.current([...annRef.current, {
          ...makeMeta(), id: makeId(), type: "pen",
          color: colorRef.current, width: swRef.current, d,
          lastX: lpt.x, lastY: lpt.y,
        }]);
      }
      setLivePts([]);
      rawPts.current = [];
    }

    if (toolRef.current === "highlight" && liveRectRef.current) {
      const lr = liveRectRef.current;
      if (lr.w > 10 && lr.h > 10) {
        onChgRef.current([...annRef.current, {
          ...makeMeta(), id: makeId(), type: "highlight",
          color: colorRef.current, ...lr,
        }]);
      }
      setLiveRect(null);
    }
  }, [makeMeta]);

  const onSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!activeRef.current || toolRef.current !== "text") return;
    const pt = getCoords(e);
    setTextInput({ x: pt.x, y: pt.y, id: makeId() });
    setTextVal("");
  }, [getCoords]);

  const commitText = useCallback(() => {
    if (textInput && textVal.trim()) {
      onChgRef.current([...annRef.current, {
        ...makeMeta(), id: textInput.id, type: "text",
        color: colorRef.current, x: textInput.x, y: textInput.y, text: textVal.trim(),
      }]);
    }
    setTextInput(null);
    setTextVal("");
  }, [textInput, textVal, makeMeta]);

  const undo  = () => onChange(annotations.slice(0, -1));
  const clear = () => onChange([]);

  const contributors = [...new Map(annotations.map(a => [a.userId, a])).values()];
  const livePath = livePts.length > 1 ? smoothPath(livePts) : null;
  const cursor = active
    ? (tool === "pen" || tool === "highlight" ? "crosshair" : tool === "text" ? "text" : "cell")
    : "default";

  return (
    <>
      {/* ── Absolute SVG — covers full document, no scroll translation needed ── */}
      {createPortal(
        <svg
          ref={svgRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: svgH,
            pointerEvents: active ? "all" : "none",
            zIndex: 48,
            cursor,
            touchAction: "none",
            userSelect: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onSvgClick}
        >
          {/* Committed annotations — coordinates are in document space, SVG is too */}
          {annotations.map(ann => {
            if (ann.type === "pen") {
              return (
                <g key={ann.id}>
                  <path d={ann.d} stroke={ann.color} strokeWidth={ann.width}
                    fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85}/>
                  <circle cx={ann.lastX} cy={ann.lastY} r={9} fill={ann.userColor} opacity={0.92}/>
                  <text x={ann.lastX} y={ann.lastY} fill="white" fontSize={7} textAnchor="middle"
                    dominantBaseline="central" fontWeight="700" style={{ userSelect: "none" }}>
                    {ann.userInitials}
                  </text>
                </g>
              );
            }
            if (ann.type === "highlight") {
              const bx = ann.x + ann.w - 2;
              const by = ann.y + 2;
              const name = ann.userName.split(" ")[0].slice(0, 10);
              const bw = name.length * 6 + 10;
              return (
                <g key={ann.id}>
                  <rect x={ann.x} y={ann.y} width={ann.w} height={ann.h} fill={ann.color} opacity={0.28}/>
                  <rect x={bx - bw} y={by} width={bw} height={14} rx={3} fill={ann.userColor} opacity={0.88}/>
                  <text x={bx - bw / 2} y={by + 7} fill="white" fontSize={8}
                    textAnchor="middle" dominantBaseline="central" fontWeight="600"
                    style={{ userSelect: "none" }}>
                    {name}
                  </text>
                </g>
              );
            }
            if (ann.type === "text") {
              return (
                <g key={ann.id}>
                  <text x={ann.x} y={ann.y} fill={ann.color} fontFamily="monospace"
                    fontSize={13} fontWeight={600}>
                    {ann.text}
                  </text>
                  <text x={ann.x + 2} y={ann.y + 15} fill={ann.userColor} fontFamily="monospace"
                    fontSize={9} opacity={0.75}>
                    {"— "}{ann.userName.split(" ")[0]}{"  "}{new Date(ann.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                  </text>
                </g>
              );
            }
            return null;
          })}

          {/* Live pen preview */}
          {livePath && (
            <path d={livePath} stroke={color} strokeWidth={strokeWidth}
              fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85}/>
          )}

          {/* Live highlight preview */}
          {liveRect && (
            <rect x={liveRect.x} y={liveRect.y} width={liveRect.w} height={liveRect.h}
              fill={color} opacity={0.28}/>
          )}

          {/* Text cursor input — in document space (same coordinate system as SVG) */}
          {textInput && (
            <foreignObject x={textInput.x} y={textInput.y - 20} width={280} height={34}>
              <input
                // @ts-expect-error xmlns valid in foreignObject children
                xmlns="http://www.w3.org/1999/xhtml"
                autoFocus
                type="text"
                value={textVal}
                onChange={e => setTextVal(e.target.value)}
                onBlur={commitText}
                onKeyDown={e => {
                  if (e.key === "Enter")  { e.preventDefault(); commitText(); }
                  if (e.key === "Escape") { setTextInput(null); setTextVal(""); }
                }}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.97)",
                  border: `2px solid ${color}`, outline: "none",
                  fontFamily: "monospace", fontSize: 13, color,
                  padding: "3px 8px", borderRadius: 4, fontWeight: 600,
                  boxShadow: `0 2px 8px ${color}40`,
                }}
              />
            </foreignObject>
          )}
        </svg>,
        document.body
      )}

      {/* ── Floating toolbar — fixed to viewport, unaffected by scroll ─────── */}
      {createPortal(
        <div
          className="fixed z-50 flex flex-col items-end gap-2 select-none"
          style={{ bottom: "5.5rem", right: "1rem" }}
        >
          {(active || expanded) && (
            <div className="bg-card border border-border shadow-2xl rounded-xl overflow-hidden"
              style={{ width: 196 }}>

              <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center justify-between">
                <span className="text-[9px] tracking-widest font-bold text-muted-foreground">ANNOTATE</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shadow"
                    style={{ background: getUserColor(userId) }}>
                    {getInitials(userName)}
                  </div>
                  <span className="text-[10px] font-medium text-foreground">{userName.split(" ")[0]}</span>
                </div>
              </div>

              <div className="p-2">
                <div className="text-[8px] tracking-widest text-muted-foreground mb-1.5 px-0.5">TOOL</div>
                <div className="grid grid-cols-4 gap-1">
                  {([
                    ["pen",       "✏️", "Draw"     ],
                    ["highlight", "▬",  "Highlight"],
                    ["text",      "T",  "Text"     ],
                    ["eraser",    "⌫",  "Erase"    ],
                  ] as const).map(([t, icon, label]) => (
                    <button key={t} onClick={() => setTool(t)} title={label}
                      className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        tool === t
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}>
                      <span className="text-sm leading-none">{icon}</span>
                      <span className="text-[8px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-2 pb-2">
                <div className="text-[8px] tracking-widest text-muted-foreground mb-1.5 px-0.5">COLOR</div>
                <div className="flex flex-wrap gap-1.5">
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => setColor(c)} title={c}
                      className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                        color === c ? "ring-2 ring-offset-1 ring-foreground scale-110" : ""
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              {tool === "pen" && (
                <div className="px-2 pb-2">
                  <div className="text-[8px] tracking-widest text-muted-foreground mb-1.5 px-0.5">WEIGHT</div>
                  <div className="flex gap-1">
                    {[1, 2, 4, 7].map(w => (
                      <button key={w} onClick={() => setStrokeWidth(w)} title={`${w}px`}
                        className={`flex-1 py-2 rounded flex items-center justify-center transition-colors ${
                          strokeWidth === w ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-muted"
                        }`}>
                        <div className="rounded-full bg-foreground" style={{ width: 18, height: w }}/>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-2 pb-2 pt-1 border-t border-border/60 flex gap-1">
                <button onClick={undo} disabled={!annotations.length}
                  className="flex-1 text-[9px] tracking-widest py-1 border border-border rounded hover:bg-muted disabled:opacity-30 font-bold text-muted-foreground transition-colors">
                  UNDO
                </button>
                <button onClick={clear} disabled={!annotations.length}
                  className="flex-1 text-[9px] tracking-widest py-1 border border-destructive/40 text-destructive rounded hover:bg-destructive/5 disabled:opacity-30 font-bold transition-colors">
                  CLEAR
                </button>
              </div>

              {contributors.length > 0 && (
                <div className="px-3 py-2 border-t border-border/60 bg-muted/20">
                  <div className="text-[8px] tracking-widest text-muted-foreground mb-1.5">
                    {annotations.length} ANNOTATION{annotations.length !== 1 ? "S" : ""}
                  </div>
                  <div className="flex flex-col gap-1">
                    {contributors.map(c => (
                      <div key={c.userId} className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-bold text-white shrink-0"
                          style={{ background: c.userColor }}>
                          {c.userInitials}
                        </div>
                        <span className="text-[9px] text-foreground/80 truncate">{c.userName}</span>
                        <span className="text-[8px] text-muted-foreground/60 ml-auto shrink-0">
                          {annotations.filter(a => a.userId === c.userId).length}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { const next = !active; setActive(next); setExpanded(next); }}
            title={active ? "Exit annotation mode" : "Annotate this page"}
            className={`w-11 h-11 rounded-full shadow-xl flex items-center justify-center text-base font-bold transition-all border-2 ${
              active
                ? "bg-primary text-primary-foreground border-primary shadow-primary/40 ring-2 ring-primary/20"
                : "bg-card text-foreground border-border hover:border-primary hover:text-primary hover:shadow-lg"
            }`}
          >
            ✏️
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
