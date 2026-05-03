import { cn } from "@/lib/utils";

const STEPS = ["UPLOAD", "OPTIONS", "REVIEW"];

export const StepIndicator = ({ step }: { step: 1 | 2 | 3 }) => (
  <div className="flex items-center gap-0 mb-6 border border-border bg-surface">
    {STEPS.map((label, i) => {
      const n = (i + 1) as 1 | 2 | 3;
      const active = n === step;
      const done = n < step;
      return (
        <div key={label} className={cn(
          "flex-1 px-4 py-3 text-xs tracking-widest border-r border-border last:border-r-0 flex items-center gap-3",
          active && "bg-primary text-primary-foreground",
          done && "text-success",
          !active && !done && "text-muted-foreground"
        )}>
          <span className={cn("inline-flex items-center justify-center w-6 h-6 text-xs font-bold border",
            active ? "border-primary-foreground" : done ? "border-success" : "border-border"
          )}>
            {done ? "✓" : n}
          </span>
          <span className="font-bold">{label}</span>
        </div>
      );
    })}
  </div>
);
