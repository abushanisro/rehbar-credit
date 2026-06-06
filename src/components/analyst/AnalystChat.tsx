import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message { role: "user" | "assistant"; content: string }

function clean(text: string): string {
  return text
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")   // strip *** ** *
    .replace(/^#{1,6}\s+/gm, "")                 // strip # headings
    .replace(/^-{3,}$/gm, "")                    // strip --- rules
    .replace(/\n{3,}/g, "\n\n")                  // collapse excess blanks
    .trim();
}

function AnalystMessage({ content }: { content: string }) {
  const lines = clean(content).split("\n");
  return (
    <div className="space-y-0.5 text-[13px] leading-snug text-[#d0d0d0]">
      {lines.map((line, i) => {
        const trimmed = line.trimEnd();
        if (trimmed === "") return <div key={i} className="h-2" />;

        // Section header: ALL CAPS ending with colon
        if (/^[A-Z][A-Z\s\/&\-]{2,}:$/.test(trimmed)) {
          return (
            <p key={i} className="text-[11px] font-bold tracking-widest text-[#E8721C] mt-2 mb-0.5 uppercase">
              {trimmed}
            </p>
          );
        }

        // Bullet: starts with · or  · (sub-bullet)
        const bulletMatch = trimmed.match(/^(\s*)[·•\-]\s+(.*)/);
        if (bulletMatch) {
          const indent = bulletMatch[1].length > 0;
          const text = bulletMatch[2];
          // Highlight "Label: Value" pairs inside bullet
          const parts = text.split(/(\w[\w\s\/&()%]+:\s*[\d.,x%₹\-—]+(?:\s*\([^)]+\))?)/g);
          return (
            <div key={i} className={`flex gap-1.5 ${indent ? "pl-4" : ""}`}>
              <span className="text-[#E8721C] mt-[1px] shrink-0 text-[10px]">·</span>
              <span>
                {parts.map((part, j) =>
                  /:\s*[\d.,x%₹\-—]+/.test(part)
                    ? <span key={j} className="text-white font-mono text-[12px]">{part}</span>
                    : <span key={j}>{part}</span>
                )}
              </span>
            </div>
          );
        }

        // Inline metric line: "Label: Value" (no bullet)
        if (/^[A-Za-z][\w\s\/&()%]+:\s*[\d.,x%₹\-—]/.test(trimmed)) {
          const colonIdx = trimmed.indexOf(":");
          const label = trimmed.slice(0, colonIdx);
          const value = trimmed.slice(colonIdx + 1).trim();
          return (
            <div key={i} className="flex items-baseline gap-1.5 font-mono text-[12px]">
              <span className="text-[#888] shrink-0">{label}:</span>
              <span className="text-white">{value}</span>
            </div>
          );
        }

        // Plain line
        return <p key={i} className="text-[#c0c0c0]">{trimmed}</p>;
      })}
    </div>
  );
}

const STARTERS_CASE = [
  "What are the key risks in this deal?",
  "Summarise the DSCR trend across years",
  "Are there any bounce concerns in bank data?",
  "How does GST turnover compare to P&L revenue?",
  "What conditions precedent would you suggest?",
];

const STARTERS_PIPELINE = [
  "How many deals are in each pipeline stage?",
  "What is the total deal value across the pipeline?",
  "Which deals have been in review the longest?",
  "Summarise the portfolio by product type",
  "Are there any overdue or stalled cases?",
];

const STARTERS_COMPANIES = [
  "How many companies are tracked?",
  "Which companies have the most active cases?",
  "Summarise the company portfolio",
];

function usePageContext() {
  const location = useLocation();
  const caseMatch = useMatch("/case/:id");
  const compMatch = useMatch("/companies/:id");
  const path = location.pathname;

  if (caseMatch?.params.id) return { caseId: caseMatch.params.id, pageName: "Case Detail", starters: STARTERS_CASE };
  if (compMatch?.params.id) return { caseId: undefined, pageName: "Company Detail", starters: STARTERS_COMPANIES };
  if (path === "/companies") return { caseId: undefined, pageName: "Companies", starters: STARTERS_COMPANIES };
  if (path === "/new")       return { caseId: undefined, pageName: "New Case",   starters: STARTERS_PIPELINE };
  return { caseId: undefined, pageName: "Pipeline", starters: STARTERS_PIPELINE };
}

const PANEL_W = 420;
const PANEL_H = 520;
const BTN_W   = 160;
const BTN_H   = 44;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(val, max));
}

function getSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem("analyst-chat-pos");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function AnalystChat() {
  const { caseId, pageName, starters } = usePageContext();
  const location = useLocation();

  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const messagesRef           = useRef<HTMLDivElement>(null);

  // ── position state ──────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const saved = getSavedPos();
    if (saved) return saved;
    return {
      x: typeof window !== "undefined" ? window.innerWidth  - PANEL_W - 24 : 200,
      y: typeof window !== "undefined" ? window.innerHeight - BTN_H   - 24 : 200,
    };
  });

  // ── drag state (refs, not state, to avoid re-renders during drag) ───────────
  const draggingRef   = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragOrigin    = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const startDrag = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current   = true;
    hasDraggedRef.current = false;
    dragOrigin.current = {
      mx: e.clientX,
      my: e.clientY,
      px: pos.x,
      py: pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.((e as React.PointerEvent).pointerId ?? 0);
  }, [pos]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - dragOrigin.current.mx;
      const dy = e.clientY - dragOrigin.current.my;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDraggedRef.current = true;
      const maxX = window.innerWidth  - (open ? PANEL_W : BTN_W) - 4;
      const maxY = window.innerHeight - (open ? PANEL_H : BTN_H) - 4;
      const newPos = { x: clamp(dragOrigin.current.px + dx, 4, maxX), y: clamp(dragOrigin.current.py + dy, 4, maxY) };
      setPos(newPos);
      localStorage.setItem("analyst-chat-pos", JSON.stringify(newPos));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
    };
  }, [open]);

  // keep inside viewport on resize
  useEffect(() => {
    const onResize = () => {
      setPos(p => ({
        x: clamp(p.x, 4, window.innerWidth  - (open ? PANEL_W : BTN_W) - 4),
        y: clamp(p.y, 4, window.innerHeight - (open ? PANEL_H : BTN_H) - 4),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // ── reset messages on page change ──────────────────────────────────────────
  useEffect(() => { setMessages([]); }, [location.pathname]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    const handleToggle = () => setOpen(o => !o);
    window.addEventListener("toggle-analyst-chat", handleToggle);
    return () => window.removeEventListener("toggle-analyst-chat", handleToggle);
  }, []);

  // ── send ────────────────────────────────────────────────────────────────────
  const send = async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || loading) return;
    setInput("");
    const next: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(next);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyst-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token ?? ""}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            case_id: caseId ?? null,
            page_name: pageName,
            current_path: location.pathname,
            messages: next,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Unknown error");
      setMessages(prev => [...prev, { role: "assistant", content: json.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Failed to reach analyst"}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const handleToggleClick = () => {
    if (!hasDraggedRef.current) setOpen(o => !o);
  };

  // ── panel renders at pos — drag constraints above guarantee it stays in viewport
  const panelLeft = clamp(pos.x, 4, window.innerWidth  - PANEL_W - 4);
  const panelTop  = clamp(pos.y, 4, window.innerHeight - PANEL_H - 4);

  return (
    <>
      {/* ── Floating toggle button (visible when panel is closed) ─────────── */}
      {!open && (
        <button
          onPointerDown={startDrag}
          onClick={handleToggleClick}
          style={{ left: pos.x, top: pos.y, touchAction: "none" }}
          className="fixed z-50 flex items-center gap-2 rounded-full bg-[#E8721C] px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-[#d0631a] transition-colors select-none cursor-grab active:cursor-grabbing"
        >
          <span className="text-base leading-none">◈</span>
          <span>Ask Analyst</span>
          <span className="text-[10px] text-white/60 ml-0.5">F4</span>
        </button>
      )}

      {/* ── Chat panel ───────────────────────────────────────────────────────── */}
      <div
        style={{
          left: panelLeft,
          top: panelTop,
          width: PANEL_W,
          maxHeight: PANEL_H,
          touchAction: "none",
        }}
        className={`fixed z-50 flex flex-col rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] shadow-2xl overflow-hidden transition-[opacity,transform] duration-200 ${
          open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
        }`}
      >
        {/* Header — drag handle */}
        <div
          onPointerDown={startDrag}
          className="flex items-center gap-2 border-b border-[#2a2a2a] px-4 py-3 cursor-grab active:cursor-grabbing select-none"
          title="Drag to move"
        >
          <span className="text-[#E8721C] text-lg leading-none">◈</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-none">Rehbar Analyst</p>
            <p className="text-[10px] text-[#666] mt-0.5">
              AI · Senior Credit Analyst
              <span className="ml-2 text-[#444]">— {pageName}</span>
            </p>
          </div>

          {/* drag hint */}
          <div className="ml-2 text-[#333] flex-shrink-0" title="Drag to reposition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
              <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
            </svg>
          </div>

          <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            <span className="text-[10px] text-[#444] font-mono">haiku-4-5</span>
            {messages.length > 0 && (
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => setMessages([])}
                className="text-[#666] hover:text-white transition-colors p-1"
                title="Clear conversation"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            )}
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => setOpen(false)}
              className="text-[#666] hover:text-white transition-colors p-1"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[#555] mb-3">
                {caseId
                  ? "Ask me anything about this case."
                  : `Ask me anything about your ${pageName.toLowerCase()}.`}
              </p>
              {starters.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full text-left text-xs text-[#888] border border-[#222] rounded px-3 py-1.5 hover:border-[#E8721C] hover:text-[#E8721C] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded px-3 py-2 ${
                  m.role === "user"
                    ? "bg-[#E8721C] text-white text-[13px] leading-snug"
                    : "bg-[#141414] border border-[#252525]"
                }`}
              >
                {m.role === "assistant"
                  ? <AnalystMessage content={m.content} />
                  : m.content
                }
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#555]">
                <span className="animate-pulse">Analysing...</span>
              </div>
            </div>
          )}

        </div>

        {/* Input */}
        <div className="border-t border-[#2a2a2a] p-3 flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask a question… (Enter to send)"
            rows={2}
            className="resize-none text-sm bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-[#444] focus-visible:ring-[#E8721C]"
            disabled={loading}
          />
          <Button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            size="sm"
            className="self-end bg-[#E8721C] hover:bg-[#d0631a] text-white"
          >
            Send
          </Button>
        </div>
      </div>
    </>
  );
}
