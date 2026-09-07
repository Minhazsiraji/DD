import { requirePlatformOwner } from "@/features/owner/authority";

/** One security boundary for every current and future /owner route. */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOwner();
  return children;
}
