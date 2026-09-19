from pathlib import Path
root = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification")

p = root / "src/features/queue/actions.ts"
s = p.read_text(encoding="utf-8")
old = '''  const { data, error } = await supabase.rpc("call_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_note: empty(formData.get("note")),
  });'''
new = '''  const { data, error } = ctx.roles.includes("ASSISTANT")
    ? await supabase.rpc("staff_call_patient", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("call_patient", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_note: empty(formData.get("note")),
      });'''
assert old in s
s = s.replace(old, new, 1)

old = '''  const { error } = await supabase.rpc("skip_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_note: empty(formData.get("note")),
  });'''
new = '''  const { error } = ctx.roles.includes("ASSISTANT")
    ? await supabase.rpc("staff_skip_patient", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("skip_patient", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_note: empty(formData.get("note")),
      });'''
assert old in s
s = s.replace(old, new, 1)
old = '''  const { error } = await supabase.rpc("set_queue_priority", {
    p_appointment_id: parsed.data.appointmentId,
    p_practice_location_id: ctx.locationId,
    p_reason: parsed.data.reason,
    p_note: empty(formData.get("note")),
  });'''
new = '''  const { error } = ctx.roles.includes("ASSISTANT")
    ? await supabase.rpc("staff_set_queue_priority", {
        target_appointment_id: parsed.data.appointmentId,
        target_location_id: ctx.locationId,
        target_reason: parsed.data.reason,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("set_queue_priority", {
        p_appointment_id: parsed.data.appointmentId,
        p_practice_location_id: ctx.locationId,
        p_reason: parsed.data.reason,
        p_note: empty(formData.get("note")),
      });'''
assert old in s
s = s.replace(old, new, 1)

old = '''  const { error } = await supabase.rpc("clear_queue_priority", {
    p_appointment_id: id,
    p_practice_location_id: ctx.locationId,
  });'''
new = '''  const { error } = ctx.roles.includes("ASSISTANT")
    ? await supabase.rpc("staff_clear_queue_priority", {
        target_appointment_id: id,
        target_location_id: ctx.locationId,
      })
    : await supabase.rpc("clear_queue_priority", {
        p_appointment_id: id,
        p_practice_location_id: ctx.locationId,
      });'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
