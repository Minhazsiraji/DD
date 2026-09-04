import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const target = requireLocalP0DatabaseUrl(process.argv[2] ?? process.env.DD_V2_LOCAL_DATABASE_URL);
const manifest = await fs.readFile(path.join(root, "db/manifest.toml"), "utf8");
const entries = [];
let entry;
for (const line of manifest.split(/\r?\n/)) {
  if (line === "[[step]]") { entry = {}; entries.push(entry); continue; }
  const match = line.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
  if (match && entry) entry[match[1]] = match[2];
}
const kinds = entries.map((item) => item.kind);
if (entries.length !== 6 || kinds.join(",") !== "schema,functions,policies,grants,storage,seed") throw new Error("manifest ordering is not canonical");
for (const item of entries) {
  const body = await fs.readFile(path.join(root, item.file));
  if (crypto.createHash("sha256").update(body).digest("hex") !== item.sha256) throw new Error(`manifest hash mismatch: ${item.file}`);
}
const dbSql = (await fs.readdir(path.join(root, "db"), { recursive: true }))
  .filter((item) => item.endsWith(".sql") && /^(schema|functions|policies|grants|storage|seed)\//.test(item))
  .map((item) => path.posix.join("db", item)).sort();
const listed = entries.map((item) => item.file).sort();
if (dbSql.join("\n") !== listed.join("\n")) throw new Error("executable db SQL exists outside manifest");
let stdout;
try {
  ({ stdout } = await exec("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", target]));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const parsedTarget = new URL(target);
  ({ stdout } = await exec("docker", ["exec", "supabase_db_DD", "pg_dump", "-U", decodeURIComponent(parsedTarget.username), "-d", parsedTarget.pathname.slice(1), "--schema-only", "--no-owner", "--no-privileges"]));
}
const canonical = stdout.replace(/^\\(restrict|unrestrict) .*$/gm, "\\$1 DD_P0_GOLDEN");
const golden = await fs.readFile(path.join(root, "db/golden-p0.sql"), "utf8");
if (canonical !== golden) throw new Error("fresh dump does not match db/golden-p0.sql");
console.log(`deployment determinism: PASS (${entries.length} manifest steps, ${dbSql.length} SQL files, ${crypto.createHash("sha256").update(golden).digest("hex")})`);
