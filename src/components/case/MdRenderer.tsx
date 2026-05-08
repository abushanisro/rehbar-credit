export function inlineMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,0.06);padding:0 3px;border-radius:2px">$1</code>');
}

const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim());

export function MdTable({ lines }: { lines: string[] }) {
  const dataLines = lines.filter((l) => !isSeparator(l));
  if (dataLines.length === 0) return null;
  const parse = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const [header, ...body] = dataLines;
  const heads = parse(header);
  return (
    <div className="overflow-x-auto my-1">
      <table className="w-full text-xs border-t border-border">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            {heads.map((h, i) => (
              <th key={i} className={`py-1 font-semibold tracking-wide ${i === 0 ? "text-left" : "text-right"}`}
                dangerouslySetInnerHTML={{ __html: inlineMd(h) }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => {
            const cells = parse(row);
            return (
              <tr key={ri} className="border-b border-border/30 hover:bg-surface/30">
                {cells.map((cell, ci) => {
                  const isStatus = /^(PASS|FAIL|CAUTION)$/i.test(cell.trim());
                  const statusCls = isStatus
                    ? /pass/i.test(cell) ? "text-success font-bold"
                    : /fail/i.test(cell) ? "text-destructive font-bold"
                    : "text-warning font-bold"
                    : "";
                  return (
                    <td key={ci}
                      className={`py-1 ${ci === 0 ? "text-left text-foreground/90" : "text-right tabular-nums text-primary"} ${statusCls}`}
                      dangerouslySetInnerHTML={{ __html: inlineMd(cell) }}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BulletOnlyMd({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { block.push(lines[i]); i++; }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{trim.replace(/^#+\s+/, "")}</div>);
      i++; continue;
    }
    i++; // skip prose paragraphs
  }
  if (out.length === 0) return null;
  return <div className="space-y-1 text-xs mt-2">{out}</div>;
}

export function MdRenderer({ text }: { text: string }) {
  if (!text) return <div className="text-muted-foreground text-xs italic">(empty)</div>;

  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    // Table block
    if (trim.startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        block.push(lines[i]);
        i++;
      }
      out.push(<MdTable key={`t-${i}`} lines={block} />);
      continue;
    }

    // Bullet list block
    if (/^[-*]\s/.test(trim)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        bullets.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-xs">
              <span className="text-warning shrink-0 mt-0.5">▸</span>
              <span className="text-foreground/90" dangerouslySetInnerHTML={{ __html: inlineMd(b) }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Headings
    if (trim.startsWith("### ")) {
      out.push(<div key={`h3-${i}`} className="text-[10px] font-bold text-accent tracking-widest mt-2 mb-0.5 uppercase">{trim.slice(4)}</div>);
      i++; continue;
    }
    if (trim.startsWith("## ") || trim.startsWith("# ")) {
      const t = trim.replace(/^#+\s+/, "");
      out.push(<div key={`h-${i}`} className="text-xs font-bold text-primary mt-2 mb-0.5">{t}</div>);
      i++; continue;
    }

    // Empty line — small gap
    if (trim === "") { i++; continue; }

    // Regular line
    out.push(
      <p key={`p-${i}`} className="text-xs text-foreground/90 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: inlineMd(trim) }}
      />
    );
    i++;
  }

  return <div className="space-y-1 text-xs">{out}</div>;
}
