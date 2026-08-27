/**
 * Stable human-facing serial for one doctor's appointment list at one chamber
 * on one clinic day.
 *
 * This is deliberately NOT the live queue token. Queue tokens are arrival-time
 * operational state; appointment serials are booking identity patients can keep
 * from the moment they book.
 *
 * Cancelled / no-show rows remain in the rank so later status changes never
 * renumber somebody else's appointment.
 */
export interface SerialSource {
  id: string;
  ownerDoctorId: string;
  practiceLocationId: string;
  sessionDate: string;
  createdAt: string;
}

export function appointmentSerials<T extends SerialSource>(
  rows: readonly T[],
): Map<string, number> {
  const ranks = new Map<string, number>();
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = `${row.ownerDoctorId}:${row.practiceLocationId}:${row.sessionDate}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      if (at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });
    group.forEach((row, index) => ranks.set(row.id, index + 1));
  }

  return ranks;
}
