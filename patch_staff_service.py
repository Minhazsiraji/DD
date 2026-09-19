from pathlib import Path
p = Path(r"C:\Users\minhaz.siraji\Documents\DD-staff-qualification\src\features\staff\service.ts")
s = p.read_text(encoding="utf-8")
old = '''export async function serviceLinkStaffInvitation(input: {
  invitationId: string;
  staffUserId: string;
}): Promise<string> {
  const client = staffPrivilegedClient();
  const { data, error } = await client.rpc("service_link_doctor_staff_invitation", {
    target_invitation_id: input.invitationId,
    target_staff_user_id: input.staffUserId,
  });
  if (error || typeof data !== "string") throw new Error("STAFF_LINK_FAILED");
  return data;
}'''
new = '''type StaffLinkRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export async function serviceLinkStaffInvitation(input: {
  invitationId: string;
  staffUserId: string;
}): Promise<string> {
  const client = staffPrivilegedClient() as unknown as StaffLinkRpcClient;
  const { data, error } = await client.rpc("service_link_doctor_staff_invitation", {
    target_invitation_id: input.invitationId,
    target_staff_user_id: input.staffUserId,
  });
  if (error || typeof data !== "string") throw new Error("STAFF_LINK_FAILED");
  return data;
}'''
assert old in s
p.write_text(s.replace(old,new,1),encoding="utf-8")
