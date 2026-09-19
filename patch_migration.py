from pathlib import Path
root = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification")
p = root / "supabase/migrations/0053_staff_management_v1.sql"
s = p.read_text(encoding="utf-8")
fragment = (root / "managed_queue_fragment.sql").read_text(encoding="utf-8").rstrip() + "\n\n"
marker = "-- New tables are Doctor-owned or actor-visible only."
assert marker in s
s = s.replace(marker, fragment + marker, 1)
old = '''  public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.view'
  )
  or public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.manage'
  )
);'''
new = '''  public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.view'
  )
  or public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.manage'
  )
  or public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'arrival.manage'
  )
);'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s, encoding="utf-8")
