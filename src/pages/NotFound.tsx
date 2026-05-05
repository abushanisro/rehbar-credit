import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";

function useClock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("en-GB", { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

const LOG_LINES = [
  { text: "CREDIT ANALYSIS ENGINE...............[ONLINE]", kind: "ok"    },
  { text: "SHARIA COMPLIANCE ENGINE.............[ACTIVE]", kind: "ok"    },
  { text: "ENCRYPTED VAULT......................[SECURE]", kind: "ok"    },
  { text: "RESOLVING ROUTE:",                              kind: "path"  },
  { text: "ERROR  0x404 — ROUTE_NOT_FOUND",               kind: "error" },
  { text: "Requested sector not in routing table.",        kind: "dim"   },
];

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const clock    = useClock();
  const pid      = useRef(Math.floor(Math.random() * 65535));

  const [cursorBlink, setCursorBlink] = useState(true);
  const [countdown,   setCountdown]   = useState(15);

  useEffect(() => { console.error("404:", location.pathname); }, [location.pathname]);

  useEffect(() => {
    const t = setInterval(() => setCursorBlink(b => !b), 520);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (countdown <= 0) { navigate("/"); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  return (
    <div className="min-h-screen bg-background text-primary font-mono flex flex-col select-none">

      {/* CRT scanlines */}
      <div className="pointer-events-none fixed inset-0 z-50"
        style={{ background: "repeating-linear-gradient(0deg,transparent 0,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)" }} />

      {/* Top bar */}
      <div className="border-b border-border bg-card/60 px-4 h-9 flex items-center justify-between text-[10px] z-10 shrink-0">
        <span className="text-primary font-bold tracking-[0.25em] glow">REHBAR//TERMINAL_OS</span>
        <div className="flex items-center gap-5">
          <span className="text-destructive font-bold tracking-widest flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
            SYS_FAULT
          </span>
          <span className="text-muted-foreground/50 tabular-nums">{clock}</span>
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 z-10">
        <div className="w-full max-w-xl flex flex-col items-center">

          {/* 404 */}
          <div className="text-[120px] sm:text-[160px] font-black leading-none tracking-tighter mb-2"
            style={{
              color: "transparent",
              WebkitTextStroke: "1.5px hsl(var(--primary))",
              textShadow: "0 0 60px hsl(var(--primary)/0.2)",
            }}>
            404
          </div>

          {/* Subtitle */}
          <div className="text-sm font-bold tracking-[0.4em] text-primary/60 uppercase mb-10">
            SECTOR NOT FOUND
          </div>

          {/* Terminal panel */}
          <div className="w-full border border-border/60 bg-card/30">

            {/* Chrome bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-card/50">
              <span className="w-2 h-2 rounded-full bg-destructive/50" />
              <span className="w-2 h-2 rounded-full bg-yellow-500/30" />
              <span className="w-2 h-2 rounded-full bg-green-500/25" />
              <span className="text-[9px] text-muted-foreground/50 tracking-[0.2em] ml-2">
                KERNEL LOG — PID:{pid.current}
              </span>
              <span className="ml-auto text-[9px] text-destructive/50 tracking-widest">● FAULT</span>
            </div>

            {/* Log */}
            <div className="px-5 py-4 space-y-1.5">
              {LOG_LINES.map((line, i) => (
                <div key={i} className="flex items-baseline gap-3 text-[11px] leading-5">
                  <span className={
                    line.kind === "error" ? "text-destructive font-bold" :
                    line.kind === "ok"    ? "text-green-400" :
                    line.kind === "dim"   ? "text-muted-foreground/40" :
                    "text-muted-foreground/70"
                  }>
                    {line.kind === "path"
                      ? <>{line.text} <span className="text-[#E8721C]">{location.pathname}</span></>
                      : line.text
                    }
                  </span>
                </div>
              ))}

              {/* Prompt */}
              <div className="flex items-center gap-2 pt-3 mt-1 border-t border-border/20 text-[11px]">
                <span className="text-[#E8721C] font-bold">rehbar@cas:~$</span>
                <span className="text-muted-foreground/60">cd /</span>
                <span className={`w-2 h-[14px] bg-primary ml-0.5 ${cursorBlink ? "opacity-100" : "opacity-0"} transition-opacity`} />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-8 w-full">
            <button
              onClick={() => navigate("/")}
              className="flex-1 py-3 text-[10px] font-bold tracking-[0.3em] uppercase border border-primary bg-primary/5 text-primary hover:bg-primary hover:text-background transition-all duration-200"
            >
              [ RETURN TO PIPELINE ]
            </button>
            <button
              onClick={() => navigate(-1)}
              className="sm:w-44 py-3 text-[10px] font-bold tracking-[0.3em] uppercase border border-border/60 text-muted-foreground hover:border-primary hover:text-primary transition-all duration-200"
            >
              [ GO BACK ]
            </button>
          </div>

          {/* Countdown */}
          <div className="mt-7 flex items-center gap-3 text-[10px] tracking-[0.2em] text-muted-foreground/50 uppercase">
            <span>Redirecting in</span>
            <span className={`font-bold tabular-nums ${countdown <= 5 ? "text-destructive" : "text-primary"}`}>
              {countdown.toString().padStart(2, "0")}s
            </span>
            <span className="flex gap-[3px]">
              {Array.from({ length: 15 }).map((_, i) => (
                <span key={i} className={`w-1 h-1 inline-block ${i < countdown ? "bg-primary/40" : "bg-border/30"}`} />
              ))}
            </span>
          </div>

        </div>
      </main>

      {/* Bottom bar */}
      <div className="border-t border-border bg-card/60 px-4 h-8 flex items-center justify-between text-[9px] text-muted-foreground/40 tracking-[0.2em] z-10 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1 h-1 bg-destructive/60 rounded-full" />
          <span>ERR 0x404</span>
          <span className="mx-3 opacity-30">·</span>
          <span className="hidden sm:inline">REHBAR FINANCIAL SERVICES</span>
        </div>
        <span className="text-destructive/50 font-bold">ROUTE_NOT_FOUND</span>
      </div>

    </div>
  );
}
