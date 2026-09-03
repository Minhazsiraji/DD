import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const root = process.cwd();
const manifestText = await fs.readFile(path.join(root, "db/manifest.toml"), "utf8");
const manifest = { step: [] };
let current;
for (const line of manifestText.split(/\r?\n/)) {
  if (line === "[[step]]") { current = {}; manifest.step.push(current); continue; }
  const match = line.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
  if (match && current) current[match[1]] = match[2];
}
if (manifest.step.length !== 6) throw new Error("manifest must contain six deployment steps");
if (process.argv[2] !== "--database-url") throw new Error("usage: deploy-fresh.mjs --database-url URL");
const sql = postgres(process.argv[3], { max: 1 });
try {
  for (const step of manifest.step) {
    const file = path.join(root, step.file);
    const body = await fs.readFile(file);
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    if (step.sha256 === "PENDING") throw new Error(`manifest hash pending: ${step.file}`);
    if (hash !== step.sha256) throw new Error(`manifest hash mismatch: ${step.file}`);
    await sql.unsafe(body.toString("utf8"));
  }
} finally { await sql.end(); }