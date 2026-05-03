export const TerminalLoader = ({ label = "LOADING" }: { label?: string }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center font-mono">
        <div className="text-primary text-sm tracking-[0.3em] mb-3 glow">{label}</div>
        <div className="flex items-center justify-center gap-1 text-primary">
          <span className="ticker-blink">█</span>
          <span className="text-xs text-muted-foreground tracking-widest">▶ STAND BY</span>
        </div>
      </div>
    </div>
  );
};
