import React from "react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  white:   "#FFFFFF",
  body:    "#1C1C1E",
  footer:  "#888888",
  altRow:  "#F5F5F0",
  headingFont: "'Playfair Display', Georgia, serif",
  bodyFont:    "'Source Serif 4', Calibri, sans-serif",
  maxWidth:    960,
} as const;

interface SlideShellProps {
  roman?: string;
  title: string;
  pageNum?: number;
  generating?: boolean;
  onGenerate?: () => void;
  children: React.ReactNode;
}

export function SlideShell({ roman, title, pageNum, generating, onGenerate, children }: SlideShellProps) {
  return (
    <div
      style={{
        maxWidth: DS.maxWidth,
        width: "100%",
        background: DS.white,
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
        borderRadius: 4,
        overflow: "hidden",
        fontFamily: DS.bodyFont,
        color: DS.body,
        marginBottom: 24,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          background: DS.navy,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 20,
          paddingRight: 16,
        }}
      >
        {/* Left: roman + title */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          {roman && (
            <span
              style={{
                color: DS.gold,
                fontWeight: 700,
                fontSize: 16,
                fontFamily: DS.headingFont,
                lineHeight: 1,
              }}
            >
              {roman}
            </span>
          )}
          <span
            style={{
              color: DS.white,
              fontSize: 15,
              fontFamily: DS.headingFont,
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
          >
            {title}
          </span>
        </div>

        {/* Right: logo + optional Generate button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/Rehbar_logo.png"
            alt="Rehbar"
            style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }}
          />
          {onGenerate && (
            <button
              onClick={onGenerate}
              disabled={generating}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.7)",
                color: DS.white,
                borderRadius: 16,
                padding: "4px 14px",
                fontSize: 11,
                fontFamily: DS.bodyFont,
                cursor: generating ? "not-allowed" : "pointer",
                opacity: generating ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "opacity 0.15s",
              }}
            >
              {generating ? (
                <>
                  <SpinnerIcon />
                  Generating…
                </>
              ) : (
                "✦ Generate"
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ minHeight: 200, background: DS.white }}>
        {generating ? <SkeletonBody /> : children}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #E5E5E0",
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        <span
          style={{
            fontSize: 8,
            color: DS.footer,
            fontStyle: "italic",
            fontFamily: DS.bodyFont,
          }}
        >
          Confidential – Rehbar Financial Services
        </span>
        {pageNum !== undefined && (
          <span style={{ fontSize: 8, color: DS.footer, fontFamily: DS.bodyFont }}>
            {pageNum}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {[80, 60, 90, 50, 70].map((w, i) => (
        <div
          key={i}
          style={{
            height: 14,
            width: `${w}%`,
            background: "linear-gradient(90deg, #F0F0ED 25%, #E5E5E0 50%, #F0F0ED 75%)",
            backgroundSize: "200% 100%",
            borderRadius: 4,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
      <style>{`
        @keyframes pulse {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ── Spinner icon ──────────────────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
