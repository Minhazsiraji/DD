import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

const root = process.cwd();

function parseManifest(text) {
  const manifest = { step: [] };
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (line === "[[step]]") { current = {}; manifest.step.push(current); continue; }
    const match = line.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
    if (match && current) current[match[1]] = match[2];
  }
  return manifest;
}

const p0 = parseManifest(await fs.readFile(path.join(root,"db/manifest.toml"),"utf8"));
const p1 = parseManifest(await fs.readFile(path.join(root,"db/manifest-p1.toml"),"utf8"));
if (p0.step.length !== 6) throw new Error("P0 manifest must remain exactly six steps");
if (p1.step.length !== 11) throw new Error("P1 manifest must contain 11 cumulative steps");
const expectedIds = Array.from({ length: 11 }, (_, index) => String(index + 1).padStart(4, "0"));
const expectedKinds = [
  "schema", "functions", "policies", "grants", "storage", "seed",
  "p1_schema", "p1_functions", "p1_rls", "p1_grants", "p1_seed",
];
if (p1.step.map((step) => step.id).join(",") !== expectedIds.join(",")) {
  throw new Error("P1 manifest step ids are not canonical 0001..0011");
}
if (p1.step.map((step) => step.kind).join(",") !== expectedKinds.join(",")) {
  throw new Error("P1 manifest step kinds/order are not canonical");
}
for (let i=0;i<6;i+=1) {
  if (JSON.stringify(p1.step[i]) !== JSON.stringify(p0.step[i])) {
    throw new Error(`P1 manifest P0 prefix mismatch at step ${i+1}`);
  }
}
const p1DiskFiles = (await fs.readdir(path.join(root, "db/p1")))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => `db/p1/${name}`)
  .sort();
const p1ManifestFiles = p1.step.slice(6).map((step) => step.file).sort();
if (p1DiskFiles.join("\n") !== p1ManifestFiles.join("\n")) {
  throw new Error(
    `P1 SQL inventory differs from manifest.\n` +
    `  on disk: ${p1DiskFiles.join(", ")}\n` +
    `  manifest: ${p1ManifestFiles.join(", ")}`,
  );
}
if (process.argv[2] !== "--database-url") throw new Error("usage: deploy-p1.mjs --database-url URL");
const databaseUrl = requireLocalP0DatabaseUrl(process.argv[3]);
const sql = postgres(databaseUrl,{max:1});
try {
  for (const step of p1.step) {
    const file=path.join(root,step.file);
    const body=await fs.readFile(file);
    const hash=crypto.createHash("sha256").update(body).digest("hex");
    if (!step.sha256 || step.sha256 === "PENDING") throw new Error(`manifest hash pending: ${step.file}`);
    if (hash !== step.sha256) throw new Error(`manifest hash mismatch: ${step.file}`);
    await sql.unsafe(body.toString("utf8"));
    console.log(`applied ${step.id} ${step.file}`);
  }
} finally { await sql.end(); }
