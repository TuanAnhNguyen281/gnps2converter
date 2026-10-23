import type { Connection, Database } from "../db/index.js";
import { boundedJson } from "./provider.js";
import { metaText } from "./review.js";

// External reference data for one row. It only sends the structure
// identifiers (InChIKey, SMILES), never report contents, and only when the
// project opted in. Results are cached so repeated questions do not re-query.
export type LookupFetch = (
  url: string,
  signal: AbortSignal,
) => Promise<Response>;
const USER_AGENT =
  "GNPS2-Converter/1.0 (research assistant; cached, low-volume lookups)";
export const defaultLookupFetch: LookupFetch = (url, signal) =>
  fetch(url, {
    signal,
    redirect: "error",
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
const TTL_DAYS = 30;
const INCHIKEY = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;
// Printable SMILES characters only; anything else is not looked up.
const SMILES = /^[A-Za-z0-9@+\-[\]()=#$%:.\\/*]{1,400}$/;

interface SourceResult {
  status: "ok" | "not_found" | "blocked" | "error" | "skipped";
  data?: Record<string, unknown>;
  message?: string;
  cached?: boolean;
  fetchedAt?: string;
}
type Db = Pick<Database | Connection, "query">;

async function cached(
  db: Db,
  source: string,
  key: string,
  fetcher: LookupFetch,
  url: string,
  parse: (json: any) => Record<string, unknown> | null,
): Promise<SourceResult> {
  const hit = (
    await db.query(
      `SELECT payload,fetched_at FROM ai_lookup_cache WHERE source=$1 AND lookup_key=$2 AND fetched_at>now()-make_interval(days => ${TTL_DAYS})`,
      [source, key],
    )
  ).rows[0];
  if (hit)
    return {
      ...(hit.payload as SourceResult),
      cached: true,
      fetchedAt: new Date(hit.fetched_at).toISOString(),
    };
  let result: SourceResult;
  try {
    const response = await fetcher(url, AbortSignal.timeout(8000));
    if (response.status === 404) {
      await response.body?.cancel();
      result = { status: "not_found" };
    } else if (!response.ok) {
      await response.body?.cancel();
      // NCBI answers abuse/blocked clients with redirects or 403/503.
      result = {
        status: [403, 429, 503].includes(response.status) ? "blocked" : "error",
        message: `HTTP ${response.status}`,
      };
    } else {
      const data = parse(await boundedJson(response, 200000));
      result = data ? { status: "ok", data } : { status: "not_found" };
    }
  } catch (e) {
    result = {
      status: (e as Error).name === "TypeError" ? "blocked" : "error",
      message:
        (e as Error).name === "TimeoutError"
          ? "Hết thời gian chờ"
          : "Không kết nối được hoặc bị chuyển hướng",
    };
  }
  // Only stable answers are cached; failures are retried next time.
  if (result.status === "ok" || result.status === "not_found")
    await db.query(
      "INSERT INTO ai_lookup_cache(source,lookup_key,payload) VALUES($1,$2,$3) ON CONFLICT(source,lookup_key) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=now()",
      [source, key, JSON.stringify(result)],
    );
  return { ...result, cached: false, fetchedAt: new Date().toISOString() };
}

export async function lookupCompound(
  db: Db,
  fetcher: LookupFetch,
  row: Record<string, any>,
) {
  const inchikey = metaText(row, "InChIKey")?.toUpperCase() ?? null,
    smiles = metaText(row, "Smiles");
  const pubchem =
    inchikey && INCHIKEY.test(inchikey)
      ? await cached(
          db,
          "pubchem",
          inchikey,
          fetcher,
          `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${inchikey}/property/Title,MolecularFormula,MolecularWeight,ExactMass,IUPACName,XLogP/JSON`,
          (json) => {
            const p = json?.PropertyTable?.Properties?.[0];
            return p
              ? {
                  cid: p.CID,
                  title: p.Title,
                  molecularFormula: p.MolecularFormula,
                  molecularWeight: Number(p.MolecularWeight),
                  exactMass: Number(p.ExactMass),
                  iupacName: p.IUPACName,
                  xlogp: p.XLogP ?? null,
                  url: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
                }
              : null;
          },
        )
      : ({
          status: "skipped",
          message: "Dòng không có InChIKey hợp lệ",
        } as SourceResult);
  const npclassifier =
    smiles && SMILES.test(smiles)
      ? await cached(
          db,
          "npclassifier",
          smiles,
          fetcher,
          `https://npclassifier.gnps2.org/classify?smiles=${encodeURIComponent(smiles)}`,
          (json) =>
            json && Array.isArray(json.class_results)
              ? {
                  pathway: json.pathway_results ?? [],
                  superclass: json.superclass_results ?? [],
                  class: json.class_results ?? [],
                  isGlycoside: json.isglycoside ?? null,
                }
              : null,
        )
      : ({
          status: "skipped",
          message: "Dòng không có SMILES hợp lệ",
        } as SourceResult);
  return {
    inchikey,
    smiles,
    pubchem,
    npclassifier,
    note: "Dữ liệu tham khảo bên ngoài theo cấu trúc thư viện; không chứng minh hợp chất có trong mẫu.",
  };
}
