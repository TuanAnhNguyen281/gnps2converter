import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { lookupCompound, type LookupFetch } from "./lookup.js";

async function memoryDb() {
  const sql = new PGlite();
  const dir = new URL("../../migrations/", import.meta.url);
  for (const n of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort())
    await sql.exec(await readFile(new URL(n, dir), "utf8"));
  return {
    query: async (text: string, values?: unknown[]) => {
      const r = await sql.query(text, values);
      return { rows: r.rows } as any;
    },
  };
}
const quercetin = {
  sourceMetadata: {
    InChIKey: "REOJLIXKJWXUGB-UHFFFAOYSA-N",
    Smiles: "O=C1C(O)=C(Oc2cc(O)cc(O)c12)c1ccc(O)c(O)c1",
  },
};
describe("external compound lookup", () => {
  it("parses PubChem and NPClassifier, then serves the cache", async () => {
    const db = await memoryDb(),
      calls: string[] = [];
    const fetcher: LookupFetch = async (url) => {
      calls.push(new URL(url).hostname);
      return url.includes("pubchem")
        ? Response.json({
            PropertyTable: {
              Properties: [
                {
                  CID: 5280343,
                  Title: "Quercetin",
                  MolecularFormula: "C15H10O7",
                  MolecularWeight: "302.23",
                  ExactMass: "302.04265",
                  IUPACName:
                    "2-(3,4-dihydroxyphenyl)-3,5,7-trihydroxychromen-4-one",
                  XLogP: 1.5,
                },
              ],
            },
          })
        : Response.json({
            class_results: ["Flavonols"],
            superclass_results: ["Flavonoids"],
            pathway_results: ["Shikimates and Phenylpropanoids"],
            isglycoside: false,
          });
    };
    const first = await lookupCompound(db, fetcher, quercetin);
    expect(first.pubchem).toMatchObject({
      status: "ok",
      cached: false,
      data: { cid: 5280343, title: "Quercetin", molecularWeight: 302.23 },
    });
    expect(first.npclassifier).toMatchObject({
      status: "ok",
      data: { class: ["Flavonols"], superclass: ["Flavonoids"] },
    });
    const second = await lookupCompound(db, fetcher, quercetin);
    expect(second.pubchem.cached).toBe(true);
    expect(second.npclassifier.cached).toBe(true);
    expect(calls).toEqual([
      "pubchem.ncbi.nlm.nih.gov",
      "npclassifier.gnps2.org",
    ]);
  });
  it("reports blocked/redirected services and does not cache failures", async () => {
    const db = await memoryDb();
    let n = 0;
    const blocked: LookupFetch = async () => {
      n++;
      // fetch(..., { redirect: "error" }) rejects on NCBI's abuse redirect.
      throw new TypeError("redirect");
    };
    const r = await lookupCompound(db, blocked, quercetin);
    expect(r.pubchem.status).toBe("blocked");
    expect(r.npclassifier.status).toBe("blocked");
    await lookupCompound(db, blocked, quercetin);
    expect(n).toBe(4);
  });
  it("skips rows without valid identifiers and caches not-found", async () => {
    const db = await memoryDb();
    let n = 0;
    const missing: LookupFetch = async () => {
      n++;
      return new Response("", { status: 404 });
    };
    const skipped = await lookupCompound(db, missing, {
      sourceMetadata: { InChIKey: "not-a-key", Smiles: "<script>" },
    });
    expect(skipped.pubchem.status).toBe("skipped");
    expect(skipped.npclassifier.status).toBe("skipped");
    expect(n).toBe(0);
    const row = { sourceMetadata: { InChIKey: "AAAAAAAAAAAAAA-BBBBBBBBBB-N" } };
    expect((await lookupCompound(db, missing, row)).pubchem.status).toBe(
      "not_found",
    );
    expect((await lookupCompound(db, missing, row)).pubchem.cached).toBe(true);
    expect(n).toBe(1);
  });
});
