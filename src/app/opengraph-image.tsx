import { ImageResponse } from "next/og";

export const alt = "Doctor's Diary by AgentSiraji";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px",
          background: "linear-gradient(135deg, #f7fbff 0%, #e7effd 55%, #dce8fb 100%)",
          color: "#13213c",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>
          AGENTSIRAJI
        </div>
        <div style={{ display: "flex", marginTop: 42, fontSize: 72, fontWeight: 800, lineHeight: 1.05 }}>
          Doctor&apos;s Diary
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 34, fontWeight: 600 }}>
          Practice &amp; Prescription Workspace for Doctors
        </div>
        <div style={{ display: "flex", marginTop: 42, fontSize: 26 }}>
          Less typing. Less searching. More patient time.
        </div>
      </div>
    ),
    size,
  );
}
