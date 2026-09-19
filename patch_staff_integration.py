from pathlib import Path

root = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification")

# appointments/actions.ts
p = root / "src/features/appointments/actions.ts"
s = p.read_text(encoding="utf-8")
old = '''  const { data, error } = await supabase.rpc("create_appointment", {
    p_owner_doctor_id: v.ownerDoctorId,
    p_practice_location_id: ctx.locationId,
    p_patient_id: v.patientId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes,
    p_visit_type: v.visitType,
    p_reason: empty(formData.get("reason")),
  });'''
new = '''  const managedTeam = ctx.roles.includes("ASSISTANT");
  const { data, error } = managedTeam
    ? await supabase.rpc("staff_create_appointment", {
        target_doctor_id: v.ownerDoctorId,
        target_location_id: ctx.locationId,
        target_patient_id: v.patientId,
        target_scheduled_for: instant,
        target_duration_minutes: v.durationMinutes,
        target_visit_type: v.visitType,
        target_reason: empty(formData.get("reason")),
      })
    : await supabase.rpc("create_appointment", {
        p_owner_doctor_id: v.ownerDoctorId,
        p_practice_location_id: ctx.locationId,
        p_patient_id: v.patientId,
        p_scheduled_for: instant,
        p_duration_minutes: v.durationMinutes,
        p_visit_type: v.visitType,
        p_reason: empty(formData.get("reason")),
      });'''
assert old in s
s = s.replace(old, new, 1)
old = '''  const { data: scoped } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", v.appointmentId)
    .eq("practice_location_id", ctx.locationId)
    .maybeSingle();'''
new = '''  const { data: scoped } = await supabase
    .from("appointments")
    .select("id, owner_doctor_id")
    .eq("id", v.appointmentId)
    .eq("practice_location_id", ctx.locationId)
    .maybeSingle();'''
assert old in s
s = s.replace(old, new, 1)
old = '''  const note = empty(formData.get("note"));
  let mutationError: { code?: string; message: string } | null = null;

  if (v.toStatus === "CANCELLED" && v.reason) {'''
new = '''  const note = empty(formData.get("note"));
  let mutationError: { code?: string; message: string } | null = null;
  const managedTeam = ctx.roles.includes("ASSISTANT");

  if (managedTeam) {
    const managed = await supabase.rpc("staff_set_appointment_status", {
      target_appointment_id: v.appointmentId,
      target_status: v.toStatus,
      target_reason: v.reason ?? null,
      target_note: note,
    });
    mutationError = managed.error;
  } else if (v.toStatus === "CANCELLED" && v.reason) {'''
assert old in s
s = s.replace(old, new, 1)
old = '''  const instant = await toInstant(ctx.locationId, v.scheduledFor);
  if (!instant) {
    return { ok: false, values: echo(formData), message: "Could not read that date and time." };
  }

  const { data, error } = await supabase.rpc("reschedule_appointment", {
    p_appointment_id: v.appointmentId,
    p_scheduled_for: instant,
    p_duration_minutes: v.durationMinutes ?? null,
    p_note: empty(formData.get("note")),
  });'''
new = '''  const instant = await toInstant(ctx.locationId, v.scheduledFor);
  if (!instant) {
    return { ok: false, values: echo(formData), message: "Could not read that date and time." };
  }

  const { data: scoped } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", v.appointmentId)
    .eq("practice_location_id", ctx.locationId)
    .maybeSingle();
  if (!scoped) {
    return { ok: false, values: echo(formData), message: "That appointment is no longer available to you." };
  }

  const { data, error } = ctx.roles.includes("ASSISTANT")
    ? await supabase.rpc("staff_reschedule_appointment", {
        target_appointment_id: v.appointmentId,
        target_location_id: ctx.locationId,
        target_scheduled_for: instant,
        target_duration_minutes: v.durationMinutes ?? null,
        target_note: empty(formData.get("note")),
      })
    : await supabase.rpc("reschedule_appointment", {
        p_appointment_id: v.appointmentId,
        p_scheduled_for: instant,
        p_duration_minutes: v.durationMinutes ?? null,
        p_note: empty(formData.get("note")),
      });'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
