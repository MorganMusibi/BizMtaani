// scripts/src/backfillLocations.ts
//
// ONE-TIME MIGRATION — run with: pnpm --filter @workspace/scripts backfill-locations
// Not deployed as a Cloud Function. Safe to re-run (idempotent: skips
// docs that already match canonical data, only writes real corrections).

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

admin.initializeApp();
const db = admin.firestore();

// ─── Load MasterHierarchy.json from disk ────────────────────────────────
interface Constituency {
  constituency_name: string;
  wards: string[];
}
interface County {
  county_code: number;
  county_name: string;
  constituencies: Constituency[];
}

const hierarchyPath = path.join(
  __dirname,
  "../../artifacts/bizmtaani/public/MasterHierarchy.json"
);
const counties: County[] = JSON.parse(fs.readFileSync(hierarchyPath, "utf-8"));

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

interface CanonicalLocation {
  wardName: string;
  constituencyName: string;
  countyName: string;
}

function resolveCanonical(
  wardName: string,
  constituencyName?: string,
  countyName?: string
): CanonicalLocation | undefined {
  if (!wardName?.trim()) return undefined;

  const normalizedWard = normalize(wardName);
  const normalizedConstituency = constituencyName ? normalize(constituencyName) : "";
  const normalizedCounty = countyName ? normalize(countyName) : "";

  for (const county of counties) {
    if (normalizedCounty && normalize(county.county_name) !== normalizedCounty) continue;
    for (const constituency of county.constituencies) {
      if (normalizedConstituency && normalize(constituency.constituency_name) !== normalizedConstituency) continue;
      const match = constituency.wards.find((w) => normalize(w) === normalizedWard);
      if (match) {
        return {
          wardName: match,
          constituencyName: constituency.constituency_name,
          countyName: county.county_name,
        };
      }
    }
  }

  for (const county of counties) {
    for (const constituency of county.constituencies) {
      const match = constituency.wards.find((w) => normalize(w) === normalizedWard);
      if (match) {
        return {
          wardName: match,
          constituencyName: constituency.constituency_name,
          countyName: county.county_name,
        };
      }
    }
  }

  return undefined;
}

let lastNominatimCallAt = 0;
async function throttleNominatim() {
  const minGapMs = 1100;
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastNominatimCallAt = Date.now();
}

async function nominatimResolve(lat: number, lng: number): Promise<CanonicalLocation | undefined> {
  await throttleNominatim();
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=14`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "BizMtaani/1.0 (contact: morganmusibi@gmail.com)",
      },
    });
    if (!res.ok) return undefined;

    const data = (await res.json()) as { address?: Record<string, string> };
    const addr = data.address ?? {};

    const wardRaw =
      addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.village ??
      addr.hamlet ?? addr.town ?? addr.municipality ?? "";
    const countyRaw = (addr.state ?? addr.county ?? "").replace(/ County$/i, "").trim();
    const constituencyRaw = addr.city_district ?? addr.county_district ?? "";

    if (!wardRaw) return undefined;

    const viaHierarchy = resolveCanonical(wardRaw, constituencyRaw, countyRaw);
    if (viaHierarchy) return viaHierarchy;

    const toTitleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      wardName: toTitleCase(wardRaw),
      constituencyName: toTitleCase(constituencyRaw),
      countyName: toTitleCase(countyRaw),
    };
  } catch (err) {
    console.error(`Nominatim fallback failed for (${lat}, ${lng}):`, err);
    return undefined;
  }
}

const PAGE_SIZE = 300;

async function runBackfill() {
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let totalScanned = 0;
  let totalUpdated = 0;
  let totalHierarchyMatched = 0;
  let totalNominatimMatched = 0;
  let totalUnresolved = 0;

  while (true) {
    let q = db.collection("products").orderBy("__name__").limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of snap.docs) {
      totalScanned++;
      const data = doc.data();
      const storedWard = (data.ward ?? "").trim();
      const storedConstituency = (data.constituency ?? "").trim();
      const storedCounty = (data.county ?? "").trim();

      if (!storedWard) {
        totalUnresolved++;
        continue;
      }

      let canonical = resolveCanonical(storedWard, storedConstituency, storedCounty);
      let source: "hierarchy" | "nominatim" | "unresolved" = canonical ? "hierarchy" : "unresolved";

      if (!canonical && typeof data.lat === "number" && typeof data.lng === "number") {
        canonical = await nominatimResolve(data.lat, data.lng);
        if (canonical) source = "nominatim";
      }

      if (!canonical) {
        totalUnresolved++;
        console.warn(`Unresolved: ${doc.id} — ward="${storedWard}" constituency="${storedConstituency}" county="${storedCounty}"`);
        continue;
      }

      if (source === "hierarchy") totalHierarchyMatched++;
      if (source === "nominatim") totalNominatimMatched++;

      const changed =
        canonical.wardName !== storedWard ||
        canonical.constituencyName !== storedConstituency ||
        canonical.countyName !== storedCounty;

      if (changed) {
        batch.update(doc.ref, {
          ward: canonical.wardName,
          constituency: canonical.constituencyName,
          county: canonical.countyName,
        });
        batchWrites++;
        totalUpdated++;
      }
    }

    if (batchWrites > 0) {
      await batch.commit();
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`Progress: scanned ${totalScanned}, updated ${totalUpdated} so far...`);

    if (snap.docs.length < PAGE_SIZE) break;
  }

  console.log("\n=== Backfill complete ===");
  console.log(`Total scanned:            ${totalScanned}`);
  console.log(`Total updated:            ${totalUpdated}`);
  console.log(`Matched via hierarchy:    ${totalHierarchyMatched}`);
  console.log(`Matched via Nominatim:    ${totalNominatimMatched}`);
  console.log(`Unresolved (left as-is):  ${totalUnresolved}`);
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
