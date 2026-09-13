from pathlib import Path
import subprocess
src = Path('.github/workflows/o1f-i2-automation.yml').read_text()
start = "cat > scripts/verify-o1f-i2-contract.mjs <<'JS'\n"
end = "\nJS\n"
if start not in src:
    raise SystemExit('start marker missing')
js = src.split(start, 1)[1].split(end, 1)[0]
bad = '''    const [{ n }] = await tx`\n      select count(*)::int as n from telemetry_day_coverage\n      where doctor_id is null\n    `.catch(() => [{ n: -1 }]);\n    void n;\n'''
if bad not in js:
    raise SystemExit('bad diagnostic block missing')
js = js.replace(bad, '')
p = Path('/tmp/generated-i2.mjs')
p.write_text(js + '\n')
print('GENERATED_LINES', len(p.read_text().splitlines()))
result = subprocess.run(['node', '--check', str(p)], text=True, capture_output=True)
print(result.stdout)
print(result.stderr)
if result.returncode:
    lines = p.read_text().splitlines()
    for i in range(435, min(490, len(lines))):
        print(f'{i+1:04d}: {lines[i]}')
raise SystemExit(result.returncode)
