import { pathToFileURL } from "node:url";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("usage: p0-run.mjs scripts/verify-name.mjs [args]");
const databaseUrl = requireLocalP0DatabaseUrl();
process.env.DD_V2_LOCAL_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.SUPABASE_DB_URL = databaseUrl;
process.argv = [process.argv[0], script, ...args, databaseUrl];
await import(pathToFileURL(`${process.cwd()}/${script}`).href);
