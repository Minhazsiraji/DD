import net from "node:net";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalP0DatabaseUrl(value) {
  if (!value) throw new Error("P0 database target missing: set DD_V2_LOCAL_DATABASE_URL");
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("P0 database target must be a valid URL"); }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) throw new Error("P0 database target must use PostgreSQL");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(hostname) && !(net.isIP(hostname) && LOCAL_HOSTS.has(hostname))) {
    throw new Error(`P0 database target rejected: non-local hostname ${parsed.hostname}`);
  }
  return parsed.toString();
}

export function requireLocalP0DatabaseUrl(value = process.env.DD_V2_LOCAL_DATABASE_URL) {
  return assertLocalP0DatabaseUrl(value);
}
