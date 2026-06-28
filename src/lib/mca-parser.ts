// Shared MCA / Corpository Excel parser
// Handles the Accumn "Advanced Excel" report format

export interface Director {
  name: string;
  din: string;
  pan?: string;
  dob?: string;
  din_status?: string;
  dsc_status?: string;
  age?: string;
  gender?: string;
  nationality?: string;
  address?: string;
  designation?: string;
  appointed_current?: string;
  originally_appointed?: string;
  cessation_date?: string;
  shareholding?: string;
  email?: string;
  phone?: string;
  remarks?: string;
}

export interface McaProfile {
  __type: "mca";
  cin?: string;
  pan?: string;
  lei?: string;
  category?: string;
  sub_category?: string;
  mca_type?: string;
  authorized_capital?: string;
  paid_up_capital?: string;
  mca_status?: string;
  nse_sector?: string;
  sector?: string;
  products_services?: string;
  email?: string;
  telephone?: string;
  date_of_incorporation?: string;
  date_of_last_bs?: string;
  date_of_last_agm?: string;
  raw_address?: string;
  about?: string;
  directors: Director[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

const n = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const notBlank = (v: string) => v && v !== "-" && v !== "--";

export function mapToIndustry(sector: string): string {
  const s = sector.toLowerCase();
  if (s.includes("real estate")) return "Real Estate";
  if (s.includes("construction") || s.includes("contracting")) return "Construction & Infrastructure";
  if (s.includes("it") || s.includes("technology") || s.includes("software")) return "IT & Technology";
  if (s.includes("financial") || s.includes("banking") || s.includes("nbfc")) return "Financial Services";
  if (s.includes("pharma") || s.includes("health")) return "Healthcare & Pharmaceuticals";
  if (s.includes("auto") || s.includes("vehicle")) return "Automotive";
  if (s.includes("textile")) return "Textile & Apparel";
  if (s.includes("retail") || s.includes("ecommerce")) return "Retail & E-commerce";
  if (s.includes("energy") || s.includes("power") || s.includes("utility")) return "Energy & Utilities";
  if (s.includes("telecom")) return "Telecom";
  if (s.includes("logistic") || s.includes("transport")) return "Logistics & Transportation";
  if (s.includes("media") || s.includes("entertainment")) return "Media & Entertainment";
  if (s.includes("education")) return "Education";
  if (s.includes("hospitality") || s.includes("hotel") || s.includes("tourism")) return "Hospitality & Tourism";
  if (s.includes("chemical") || s.includes("petro")) return "Chemicals & Petrochemicals";
  if (s.includes("manufactur")) return "Manufacturing";
  if (s.includes("trading") || s.includes("trade")) return "Trading";
  if (s.includes("agriculture") || s.includes("food")) return "Agriculture & Food Processing";
  return "";
}

export function mapToConstitution(category: string, type: string): string {
  const c = `${category} ${type}`.toLowerCase();
  if (c.includes("public") && (c.includes("listed") || c.includes("shares"))) return "Public Ltd";
  if (c.includes("public")) return "Public Ltd";
  if (c.includes("private")) return "Pvt Ltd";
  if (c.includes("llp") || c.includes("limited liability partnership")) return "LLP";
  if (c.includes("partnership")) return "Partnership";
  if (c.includes("proprietor")) return "Proprietorship";
  if (c.includes("individual")) return "Individual";
  return "";
}

// ── main parser ───────────────────────────────────────────────────────────────

export async function parseAccumnExcel(file: File): Promise<{
  profile: McaProfile;
  companyName: string;
  websiteUrl: string;
}> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const profile: McaProfile = { __type: "mca", directors: [] };
  let companyName = "";
  let websiteUrl = "";

  // Find Profile and Directors sheets via Index sheet first
  let profileSheetName: string | null = null;
  let directorsSheetName: string | null = null;

  const indexWs = wb.Sheets["Index"];
  if (indexWs) {
    const idxRows = XLSX.utils.sheet_to_json<unknown[]>(indexWs, { header: 1, defval: "" }) as string[][];
    for (const row of idxRows) {
      const sheetNum = String(row[0] ?? "").trim();
      const particular = String(row[1] ?? "").trim().toLowerCase();
      if (particular === "profile" && wb.Sheets[sheetNum]) profileSheetName = sheetNum;
      if (particular === "directors" && wb.Sheets[sheetNum]) directorsSheetName = sheetNum;
    }
  }

  // Fallback: scan all sheets for structural markers
  if (!profileSheetName || !directorsSheetName) {
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];
      for (let ri = 0; ri < Math.min(15, rows.length); ri++) {
        const row = rows[ri].map(c => String(c ?? "").trim());
        if (!profileSheetName && row.some(c => c.toUpperCase().includes("COMPANY DETAILS")))
          profileSheetName = sn;
        if (!directorsSheetName && row[0]?.toLowerCase() === "name" && row[1]?.toLowerCase().includes("din"))
          directorsSheetName = sn;
      }
    }
  }

  // ── Parse Profile sheet ────────────────────────────────────────────────────
  if (profileSheetName && wb.Sheets[profileSheetName]) {
    const ws = wb.Sheets[profileSheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];

    // Company name is in row index 2, col 0
    const nameRow = rows[2]?.map(c => String(c ?? "").trim()) ?? [];
    const candidateName = nameRow.find(c => c.length > 2 && c !== "Go to Index");
    if (candidateName) companyName = candidateName;

    for (const rawRow of rows) {
      const cells = rawRow.map(c => String(c ?? "").trim());

      // Col A/B pairs
      const lA = n(cells[0] ?? "");
      const vB = cells[1] ?? "";

      if (notBlank(vB)) {
        if (lA === "cin") profile.cin = vB;
        else if (lA === "name") companyName = vB;
        else if (lA === "pan") profile.pan = vB;
        else if (lA === "lei") profile.lei = vB;
        else if (lA === "category") profile.category = vB;
        else if (lA === "subcategory") profile.sub_category = vB;
        else if (lA === "type") profile.mca_type = vB;
        else if (lA === "authorizedcapital") profile.authorized_capital = vB;
        else if (lA === "paidupcapital") profile.paid_up_capital = vB;
        else if (lA === "status" && !profile.mca_status) profile.mca_status = vB;
        else if (lA === "nsesector") profile.nse_sector = vB;
        else if (lA.includes("corpository") && lA.includes("sector")) profile.sector = vB;
        else if (lA.startsWith("product")) profile.products_services = vB;
        else if (lA === "fulladdress") profile.raw_address = vB;
        else if (lA === "about" || lA === "aboutthecompany") profile.about = vB;
        else if (lA === "emailid" || lA === "email") profile.email = vB;
        else if (lA === "website") websiteUrl = vB.startsWith("http") ? vB : `https://${vB}`;
        else if (lA.includes("telephone") || lA === "phonenumber") profile.telephone = vB;
      }

      // Col D/E pairs (important dates — indices 3 and 4)
      const lD = n(cells[3] ?? "");
      const vE = cells[4] ?? "";
      if (notBlank(vE)) {
        if (lD === "dateofincorporation") profile.date_of_incorporation = vE;
        else if (lD.includes("lastbalancesheet")) profile.date_of_last_bs = vE;
        else if (lD.includes("lastagm")) profile.date_of_last_agm = vE;
      }

      // "About the company" — long string in col A with no col B value
      if (!vB && (cells[0] ?? "").length > 200 && !profile.about)
        profile.about = (cells[0] ?? "").substring(0, 3000);
    }
  }

  // ── Parse Directors sheet ──────────────────────────────────────────────────
  if (directorsSheetName && wb.Sheets[directorsSheetName]) {
    const ws = wb.Sheets[directorsSheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];

    // Find header row (first row where col 0 = "NAME" and col 1 contains "DIN")
    let headerRow: string[] = [];
    let headerIdx = -1;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri].map(c => String(c ?? "").trim());
      if (row[0]?.toLowerCase() === "name" && row[1]?.toLowerCase().includes("din")) {
        headerRow = row;
        headerIdx = ri;
        break;
      }
    }

    if (headerIdx >= 0) {
      for (let ri = headerIdx + 1; ri < rows.length; ri++) {
        const row = rows[ri].map(c => String(c ?? "").trim());
        if (row.every(c => !c)) break;

        const dir: Director = { name: "", din: "" };

        headerRow.forEach((h, i) => {
          const val = row[i] ?? "";
          if (!notBlank(val)) return;
          const hn = n(h);

          if (i === 0) {
            // NAME (DOB: dd/mm/yyyy)
            const m = val.match(/^(.+?)\s*\(DOB:\s*(.+?)\)/i);
            if (m) { dir.name = m[1].trim(); dir.dob = m[2].trim() === "-" ? undefined : m[2].trim(); }
            else dir.name = val.trim();
          } else if (i === 1) {
            // DIN/PAN — e.g. "00009596(AAHPS2338C)" or "*****3990K(-)"
            const m = val.match(/^(\*{0,5}[\d]+)\s*\((.+?)\)/);
            if (m) {
              dir.din = m[1];
              dir.pan = notBlank(m[2]) ? m[2] : undefined;
            } else dir.din = val;
          } else if (hn.includes("dinstatus")) dir.din_status = val;
          else if (hn.includes("dscstatus")) dir.dsc_status = val;
          else if (hn === "age") dir.age = val;
          else if (hn === "gender") dir.gender = val;
          else if (hn === "nationality") dir.nationality = val;
          else if (hn === "address") dir.address = val;
          else if (hn.includes("appointmentatcurrent")) dir.appointed_current = val;
          else if (hn.includes("designation") || hn.includes("category")) dir.designation = val;
          else if (hn.includes("originallyappointed")) dir.originally_appointed = val;
          else if (hn.includes("cessation")) dir.cessation_date = val;
          else if (hn.includes("shareholding")) dir.shareholding = val;
          else if (hn.includes("emailaddress") || hn === "email") dir.email = val;
          else if (hn.includes("phonenumber") || hn === "phone") dir.phone = val;
          else if (hn === "remarks") dir.remarks = val;
        });

        if (dir.name && dir.name.toLowerCase() !== "name" && dir.name.length > 1)
          profile.directors.push(dir);
      }
    }
  }

  return { profile, companyName, websiteUrl };
}
