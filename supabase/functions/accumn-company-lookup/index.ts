/**
 * Rehbar — Accumn company profile lookup by PAN or CIN.
 * Two-phase async design (avoids long-running connections):
 *   POST { identifier_type, identifier_value }
 *     → creates INSIGHTS order, returns { ff_order_id, status: "pending" }
 *   POST { ff_order_id }
 *     → checks order status; returns { status: "pending" } or { status: "done", profile }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleOptions } from "../_shared/cors.ts";
import {
  callAccumn,
  checkAccumnOrderStatus,
  getAccumnFileDetails,
  downloadAccumnMrd,
  getLenderInfo,
} from "../_shared/accumn-client.ts";

declare const Deno: { env: { get(k: string): string | undefined } };

const resp = (body: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── Company profile extractor from INSIGHTS MRD ───────────────────────────────

function s(v: unknown): string {
  const str = v != null ? String(v).trim() : "";
  return str === "-" || str === "--" ? "" : str;
}

function safeNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function extractYear(doi: string): string {
  if (!doi) return "";
  for (const part of doi.split(/[\/\-]/).reverse()) {
    if (/^\d{4}$/.test(part.trim())) return part.trim();
  }
  return "";
}

function mapConstitution(category: string, sub: string): string {
  const t = (category + " " + sub).toLowerCase();
  if (t.includes("private"))  return "Pvt Ltd";
  if (t.includes("public limited")) return "Public Ltd";
  if (t.includes("llp") || t.includes("limited liability partnership")) return "LLP";
  if (t.includes("partnership")) return "Partnership";
  if (t.includes("proprietor"))  return "Proprietorship";
  return "";
}

function extractProfile(mrd: Record<string, unknown>) {
  const ci = (mrd.company_info ?? mrd.company_profile ?? mrd.company ?? {}) as Record<string, unknown>;

  const companyName = s(mrd.company_name ?? mrd.name ?? mrd.entity_name ?? ci.company_name ?? ci.name);
  const cin = s(mrd.cin ?? mrd.company_identification_number ?? ci.cin);
  const pan = s(mrd.pan ?? mrd.permanent_account_number ?? ci.pan);
  const lei = s(mrd.lei ?? ci.lei);

  const doi = s(mrd.date_of_incorporation ?? mrd.incorporation_date ?? ci.date_of_incorporation);
  const yearEstablished = extractYear(doi);

  const category    = s(mrd.company_category ?? mrd.category ?? mrd.class_of_company ?? ci.company_category ?? ci.category);
  const subCategory = s(mrd.sub_category ?? mrd.company_sub_category ?? ci.sub_category);
  const mcaType     = s(mrd.company_type  ?? mrd.mca_type ?? ci.company_type ?? ci.mca_type);
  const constitution = mapConstitution(category, subCategory);
  const mcaStatus   = s(mrd.company_status ?? mrd.status ?? ci.company_status ?? ci.status);

  const sector    = s(mrd.industry ?? mrd.sector ?? mrd.nse_sector ?? mrd.industry_sector ?? ci.industry ?? ci.sector);
  const nseSector = s(mrd.nse_sector ?? ci.nse_sector);
  const products  = s(mrd.products_services ?? mrd.products ?? ci.products_services);
  const address   = s(mrd.registered_office ?? mrd.registered_address ?? mrd.address ?? ci.registered_office ?? ci.registered_address);
  const email     = s(mrd.email ?? mrd.company_email ?? ci.email);
  const telephone = s(mrd.phone ?? mrd.telephone ?? mrd.contact_number ?? ci.telephone ?? ci.phone);
  const website   = s(mrd.website ?? mrd.company_website ?? ci.website);
  const about     = s(mrd.about ?? mrd.description ?? mrd.business_description ?? ci.about);
  const lastBs    = s(mrd.date_of_last_bs  ?? mrd.last_balance_sheet_date ?? ci.date_of_last_bs);
  const lastAgm   = s(mrd.date_of_last_agm ?? mrd.last_agm_date           ?? ci.date_of_last_agm);

  const authCap = safeNum(mrd.authorized_capital ?? mrd.authorised_capital ?? ci.authorized_capital);
  const paidCap = safeNum(mrd.paid_up_capital ?? ci.paid_up_capital);

  const rawDirs = (mrd.directors ?? mrd.board_of_directors ?? ci.directors ?? []) as unknown[];
  const directors = Array.isArray(rawDirs)
    ? rawDirs.map((d: unknown) => {
        const r = (d ?? {}) as Record<string, unknown>;
        return {
          name:                 s(r.name ?? r.director_name),
          din:                  s(r.din  ?? r.director_identification_number),
          pan:                  s(r.pan),
          dob:                  s(r.dob  ?? r.date_of_birth),
          din_status:           s(r.din_status),
          dsc_status:           s(r.dsc_status),
          age:                  s(r.age),
          gender:               s(r.gender),
          nationality:          s(r.nationality),
          address:              s(r.address ?? r.director_address),
          designation:          s(r.designation ?? r.category),
          appointed_current:    s(r.appointed_current ?? r.appointment_date),
          originally_appointed: s(r.originally_appointed),
          cessation_date:       s(r.cessation_date ?? r.date_of_cessation),
          shareholding:         s(r.shareholding),
          email:                s(r.email),
          phone:                s(r.phone),
          remarks:              s(r.remarks),
        };
      }).filter(d => d.name)
    : [];

  return {
    company_name:         companyName,
    cin, pan, lei,
    year_established:     yearEstablished,
    legal_constitution:   constitution,
    category, sub_category: subCategory, mca_type: mcaType, mca_status: mcaStatus,
    sector, nse_sector: nseSector, products_services: products,
    email, telephone, website, about,
    date_of_incorporation: doi, date_of_last_bs: lastBs, date_of_last_agm: lastAgm,
    registered_address:   address,
    authorized_capital:   authCap != null ? String(authCap) : undefined,
    paid_up_capital:      paidCap != null ? String(paidCap) : undefined,
    directors,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return resp({ error: "Unauthorized" }, 401, cors);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient  = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return resp({ error: "Unauthorized" }, 401, cors);

    const body: { identifier_type?: "PAN" | "CIN"; identifier_value?: string; ff_order_id?: string } = await req.json();

    // ── Phase 2: poll an existing order ──────────────────────────────────────
    if (body.ff_order_id) {
      const status = await checkAccumnOrderStatus(body.ff_order_id);

      if (status === "Cancelled") {
        return resp({ status: "cancelled", error: "Order cancelled — identifier may be invalid or not found" }, 422, cors);
      }

      if (status !== "Completed") {
        return resp({ status: "pending" }, 200, cors);
      }

      // Completed — download MRD and extract profile
      const files   = await getAccumnFileDetails(body.ff_order_id);
      const mrdFile = files.find(f => f.file_category === "MRD" && f.mime_type === "application/json")
                   ?? files.find(f => f.mime_type === "application/json");

      if (!mrdFile) {
        return resp({ status: "done", profile: null, error: "No MRD file found in completed order" }, 200, cors);
      }

      const mrdJson = await downloadAccumnMrd(mrdFile.download_url);
      const profile = extractProfile(mrdJson as Record<string, unknown>);
      return resp({ status: "done", profile }, 200, cors);
    }

    // ── Phase 1: create a new INSIGHTS order ─────────────────────────────────
    const identifierType  = body.identifier_type  ?? "PAN";
    const identifierValue = (body.identifier_value ?? "").trim().toUpperCase();
    if (!identifierValue) return resp({ error: "identifier_value required" }, 400, cors);

    const lenderInfo = {
      ...getLenderInfo(),
      lender_referenceNumber: `LOOKUP-${identifierValue}-${Date.now()}`,
    };

    const createResp = await callAccumn<{ statusCode: number; data?: { ffOrderId?: string }; msg?: string }>({
      request: "create-order",
      param: {
        lenderInfo,
        requestorInfo: {
          requestor_name:     user.email ?? "Analyst",
          requestor_email:    Deno.env.get("ACCUMN_EMAIL") ?? user.email ?? "",
          requestor_division: Deno.env.get("ACCUMN_REQUESTOR_DIVISION") ?? "Credit",
          requestor_branch:   "HQ",
          requestor_phone:    "",
        },
        borrowerInfo: { borrower_name: `Lookup ${identifierType}: ${identifierValue}` },
        dataRelatedInfo: {
          insightsInfo: { identifier: identifierType, value: identifierValue },
        },
        orderInfo: { product_name: "INSIGHTS" },
      },
    });

    if ((createResp.statusCode !== 1 && createResp.statusCode !== 2) || !createResp.data?.ffOrderId) {
      return resp({ error: `Accumn order failed: ${createResp.msg ?? "no ffOrderId"}` }, 502, cors);
    }

    return resp({ status: "pending", ff_order_id: createResp.data.ffOrderId }, 200, cors);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("accumn-company-lookup:", msg);
    return resp({ error: msg }, 500, cors);
  }
});

export {};
