import type { MetadataRoute } from "next";

/**
 * PWA manifest — installable shell only.
 *
 * Deliberately NO offline write support. Offline mutation of clinical records
 * means conflict resolution on prescriptions and encounters, which is a patient
 * safety hazard. All writes require connectivity and must fail loudly.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Doctor's Diary",
    short_name: "Doctor's Diary",
    description:
      "Clinical and chamber workspace for doctors — patients, appointments, queue, consultations and prescriptions.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#e4edfd",
    theme_color: "#e4edfd",
    categories: ["medical", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
