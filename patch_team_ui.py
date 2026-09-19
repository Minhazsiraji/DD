from pathlib import Path
p = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification\src\app\(app)\settings\team\page.tsx")
s = p.read_text(encoding="utf-8")
old = '''                      {grant.status !== "ACTIVE" ? (
                        <button name="status" value="ACTIVE" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Reactivate</button>
                      ) : (
                        <button name="status" value="TEMPORARILY_DISABLED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Temporarily disable</button>
                      )}
                      {grant.status !== "REMOVED" ? (
                        <button name="status" value="REMOVED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Remove access</button>
                      ) : null}'''
new = '''                      {grant.status === "TEMPORARILY_DISABLED" ? (
                        <button name="status" value="ACTIVE" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Reactivate</button>
                      ) : null}
                      {grant.status === "ACTIVE" ? (
                        <button name="status" value="TEMPORARILY_DISABLED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Temporarily disable</button>
                      ) : null}
                      {grant.status !== "REMOVED" ? (
                        <button name="status" value="REMOVED" className="min-h-11 rounded-xl border border-hairline px-3 text-sm font-semibold">Remove access</button>
                      ) : (
                        <span className="self-center text-xs text-ink-muted">Re-add through a new invitation.</span>
                      )}'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
