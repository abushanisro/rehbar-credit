import React from "react";

interface SiteVisitPicturesCardProps {
  clientName: string;
  pageNum: number;
  attachments?: Array<{ url?: string; caption?: string; label?: string }>;
}

export function SiteVisitPicturesCard({ clientName, pageNum, attachments }: SiteVisitPicturesCardProps) {
  const photos = (attachments ?? []).filter((a) => a.url);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 960,
        background: "#FFFFFF",
        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 24,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Source Serif 4', Calibri, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "2px solid #E8E8E4",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#1C1C1E",
            fontFamily: "'Playfair Display', Georgia, serif",
          }}
        >
          Pictures of {clientName}
        </span>
        <img src="/Rehbar_logo.png" alt="Rehbar" style={{ height: 28, objectFit: "contain", background: "#FFFFFF", borderRadius: 4, padding: "2px 6px" }} />
      </div>

      {/* Photo grid */}
      <div style={{ padding: "20px 28px", minHeight: 200 }}>
        {photos.length > 0 ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 16,
              }}
            >
              {photos.map((photo, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <img
                    src={photo.url}
                    alt={photo.caption ?? photo.label ?? `Photo ${i + 1}`}
                    style={{
                      width: "100%",
                      height: 140,
                      objectFit: "cover",
                      borderRadius: 3,
                      border: "1px solid #E8E8E4",
                    }}
                  />
                  {(photo.caption || photo.label) && (
                    <span style={{ fontSize: 10, color: "#555", textAlign: "center", lineHeight: 1.4 }}>
                      {photo.caption ?? photo.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Placeholder grid — two empty boxes */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  height: 160,
                  background: "#F5F5F0",
                  border: "1.5px dashed #D4D4CE",
                  borderRadius: 4,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid #E8E8E4",
          padding: "6px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 9, color: "#AAAAAA", fontStyle: "italic" }}>
          Confidential – Rehbar Internal use only
        </span>
        <span style={{ fontSize: 9, color: "#AAAAAA" }}>{pageNum}</span>
      </div>
    </div>
  );
}
