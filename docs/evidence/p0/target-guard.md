# Track-A Target Guard

All package database commands route through `scripts/p0-run.mjs`, which requires
`DD_V2_LOCAL_DATABASE_URL` and validates it before importing the target script.
Only `localhost`, `127.0.0.1`, and `::1` are accepted for PostgreSQL URLs.
Remote hostnames, including arbitrary `*.supabase.co`, are rejected before a
Postgres client is created. Generic `DATABASE_URL`, `DIRECT_URL`, and
`SUPABASE_DB_URL` are not used as input; the wrapper exports them only after
the dedicated target has passed validation for legacy script compatibility.

The guard tests cover three accepted loopback URLs and three rejected unsafe
targets. No rejected case opens a database connection.