import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const GLITCH_CHARS = "!<>-_\\/[]{}—=+*^?#@$%&~|";

function useGlitch(text: string, active: boolean) {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    if (!active) { setDisplay(text); return; }
    let frame = 0;
    const total = 18;
    const id = setInterval(() => {
      setDisplay(
        text.split("").map((ch, i) =>
          i < Math.floor((frame / total) * text.length)
            ? ch
            : ch === " " ? " " : GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
        ).join("")
      );
      if (++frame > total) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [text, active]);
  return display;
}

const BOOT_LINES = [
  { text: "REHBAR CREDIT TERMINAL v1.1.4",         delay: 0 },
  { text: "Loading kernel modules............[OK]", delay: 150 },
  { text: "Mounting filesystem................[OK]", delay: 300 },
  { text: "Starting auth daemon...............[OK]", delay: 450 },
  { text: "Connecting to Supabase.............[OK]", delay: 600 },
  { text: "Resolving route: " ,                     delay: 800, isPath: true },
  { text: "",                                        delay: 1000 },
  { text: "██ KERNEL PANIC ██",                     delay: 1200, isError: true },
  { text: "Segmentation fault (core dumped)",        delay: 1350, isError: true },
  { text: "Memory at 0x00000404 corrupted",          delay: 1500, isError: true },
  { text: "",                                        delay: 1600 },
  { text: "ERROR 0x404: PAGE_NOT_FOUND",             delay: 1800, isError: true },
  { text: "The requested route does not exist in the routing table.", delay: 2000 },
  { text: "Stack trace:",                            delay: 2200 },
  { text: "  at Router.resolve (router.js:404)",    delay: 2300 },
  { text: "  at BrowserRouter.navigate (app.tsx:1)",delay: 2400 },
  { text: "  at Window.dispatch (event-loop:0x0)",  delay: 2500 },
  { text: "",                                        delay: 2700 },
  { text: "Recommended action: Return to known sector.", delay: 2900 },
];

export default function NotFound() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [visibleLines, setVisibleLines] = useState(0);
  const [cursorBlink, setCursorBlink]   = useState(true);
  const [glitchActive, setGlitchActive] = useState(false);
  const [countdown, setCountdown]       = useState(15);
  const [noiseOpacity, setNoiseOpacity] = useState(0.05);

  const headline = useGlitch("404 — SECTOR NOT FOUND", glitchActive);

  useEffect(() => {
    console.error("404:", location.pathname);
  }, [location.pathname]);

  // Reveal boot lines
  useEffect(() => {
    const timers = BOOT_LINES.map((_, i) =>
      setTimeout(() => setVisibleLines(i + 1), BOOT_LINES[i].delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Cursor blink
  useEffect(() => {
    const t = setInterval(() => setCursorBlink(b => !b), 530);
    return () => clearInterval(t);
  }, []);

  // Noise flicker and glitch bursts
  useEffect(() => {
    const t = setInterval(() => {
      setGlitchActive(true);
      setNoiseOpacity(0.15);
      setTimeout(() => {
        setGlitchActive(false);
        setNoiseOpacity(0.05);
      }, 300 + Math.random() * 500);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // Auto-redirect countdown
  useEffect(() => {
    if (countdown <= 0) { navigate("/"); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  return (
    <div className="min-h-screen bg-background text-primary font-mono flex flex-col relative overflow-hidden select-none">
      
      {/* CRT Scanline Overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] animate-pulse"
        style={{ background: "repeating-linear-gradient(0deg, #000, #000 2px, transparent 2px, transparent 4px)" }} />
      
      {/* Noise Texture */}
      <div className="pointer-events-none fixed inset-0 z-[49] transition-opacity duration-75"
        style={{ 
          opacity: noiseOpacity,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
        }} />

      {/* Top Status Bar */}
      <div className="border-b border-border bg-surface/50 backdrop-blur-sm px-4 h-9 flex items-center justify-between text-[10px] z-10">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold tracking-[0.2em] glow">REHBAR//TERMINAL_OS</span>
          <span className="text-muted-foreground opacity-50 px-2 border-l border-border">v1.1.4-LTS</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-destructive font-bold tracking-widest animate-pulse flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]" />
            SYS_FAULT
          </span>
          <span className="text-muted-foreground tabular-nums">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 z-10 relative">
        
        {/* Background '404' watermark */}
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none select-none">
          <span className="text-[40vw] font-black leading-none">404</span>
        </div>

        {/* Central Fault Container */}
        <div className="w-full max-w-2xl flex flex-col items-center animate-in fade-in zoom-in duration-700">
          
          {/* Big Glitch 404 */}
          <div className="relative mb-8 group cursor-default">
            <div className="text-[120px] sm:text-[200px] font-black leading-none tracking-tighter text-primary/5 select-none"
                 style={{ WebkitTextStroke: "1px hsl(var(--primary) / 0.1)" }}>
              404
            </div>
            <div 
              className={`absolute inset-0 flex items-center justify-center text-[120px] sm:text-[200px] font-black leading-none tracking-tighter transition-all duration-300 ${glitchActive ? 'scale-105 skew-x-12' : ''}`}
              style={{
                WebkitTextStroke: "1px hsl(var(--primary))",
                color: "transparent",
                textShadow: glitchActive
                  ? "4px 0 hsl(var(--destructive)), -4px 0 hsl(var(--accent)), 0 0 20px hsl(var(--primary))"
                  : "0 0 30px hsl(var(--primary) / 0.3)",
              }}
            >
              404
            </div>
          </div>

          {/* Fault Headline */}
          <div className={`text-xl sm:text-3xl font-bold tracking-[0.3em] mb-12 uppercase text-center ${glitchActive ? "text-destructive skew-x-3" : "text-primary"} transition-all glow`}>
            {headline}
          </div>

          {/* Terminal Console */}
          <div className="w-full bg-card/40 backdrop-blur-md border border-border/50 p-6 rounded shadow-2xl relative group overflow-hidden">
            {/* Scan-line moving through terminal */}
            <div className="scan-line opacity-10" />
            
            <div className="flex items-center gap-2 mb-4 border-b border-border/30 pb-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-warning/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-success/50" />
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] ml-2">
                Kernel Log / Terminal Input
              </div>
            </div>

            <div className="space-y-1 font-mono">
              {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
                <div
                  key={i}
                  className={`text-[12px] leading-relaxed tracking-wide ${
                    line.isError ? "text-destructive font-bold" : "text-muted-foreground"
                  }`}
                >
                  <span className="opacity-30 mr-3 tabular-nums">[{((i * 137) % 1000).toString().padStart(3, '0')}.{(i * 11).toString().padStart(2, '0')}]</span>
                  {line.isPath
                    ? <span>{line.text}<span className="text-warning underline decoration-dotted underline-offset-4">{location.pathname}</span></span>
                    : line.text || "\u00A0"
                  }
                </div>
              ))}
              
              {/* Active Prompt */}
              <div className="text-[12px] flex items-center gap-2 pt-2 border-t border-border/20 mt-4">
                <span className="text-primary font-bold">rehbar@cas:~$</span>
                <span className="text-primary animate-pulse">resolve_route --force</span>
                <span className={`w-2.5 h-4 bg-primary ${cursorBlink ? "opacity-100" : "opacity-0"}`} />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 mt-12 w-full max-w-md">
            <button
              onClick={() => navigate("/")}
              className="flex-1 px-8 py-3 text-[11px] font-black tracking-[0.2em] uppercase border-2 border-primary bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300 shadow-[0_0_15px_hsl(var(--primary)/0.2)] active:scale-95"
            >
              [ Return to Secure Sector ]
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-8 py-3 text-[11px] font-black tracking-[0.2em] uppercase border-2 border-border text-muted-foreground hover:border-primary hover:text-primary transition-all duration-300 active:scale-95"
            >
              [ Previous Node ]
            </button>
          </div>

          {/* Redirect Timer */}
          <div className="mt-8 text-[11px] text-muted-foreground tracking-[0.2em] uppercase flex items-center gap-3">
            <span>Terminal shutdown in</span>
            <span className={`font-bold tabular-nums text-sm ${countdown <= 5 ? "text-destructive animate-pulse" : "text-primary"}`}>
              {countdown.toString().padStart(2, '0')}s
            </span>
          </div>
        </div>
      </main>

      {/* Bottom Information Strip */}
      <div className="border-t border-border bg-surface/50 backdrop-blur-sm px-4 h-8 flex items-center justify-between text-[9px] text-muted-foreground tracking-[0.2em] z-10">
        <div className="flex gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-primary" />
            ERR_CODE: 0x404
          </span>
          <span className="hidden sm:inline">ADDR: {location.pathname.toUpperCase()}</span>
          <span className="hidden sm:inline">PID: {Math.floor(Math.random() * 9999)}</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-destructive font-bold">STATUS: CRITICAL_FAILURE</span>
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 ${i < 4 ? 'bg-primary' : 'bg-muted'} opacity-50`} />
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
