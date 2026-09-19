from pathlib import Path
p = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification\src\features\queue\queries.ts")
s = p.read_text(encoding="utf-8")
s = s.replace('import { requireUser } from "@/lib/auth/session";', 'import { requireLocationContext } from "@/lib/auth/session";')
old = '''  await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await timedPreviewStage(
    "m1-queue-timing",
    "get_queue_rpc",
    supabase.rpc("get_queue", {
      p_practice_location_id: practiceLocationId,
      p_session_date: sessionDate,
    }),
  );'''
new = '''  const ctx = await requireLocationContext();
  if (ctx.locationId !== practiceLocationId) {
    return { ok: false, reason: "location-context-changed" };
  }
  const supabase = await createSupabaseServerClient();
  const managedTeam = ctx.roles.includes("ASSISTANT");

  const { data, error } = await timedPreviewStage(
    "m1-queue-timing",
    managedTeam ? "staff_get_queue_rpc" : "get_queue_rpc",
    managedTeam
      ? supabase.rpc("staff_get_queue", {
          target_location_id: practiceLocationId,
          target_session_date: sessionDate,
        })
      : supabase.rpc("get_queue", {
          p_practice_location_id: practiceLocationId,
          p_session_date: sessionDate,
        }),
  );'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
