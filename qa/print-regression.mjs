import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const executablePath = process.env.BROWSER_EXECUTABLE || undefined;
const label = process.env.BROWSER_LABEL || "chromium";
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.addInitScript(() => {
  window.__qaPrintCalls = 0;
  window.print = () => { window.__qaPrintCalls += 1; };
});

await page.goto("http://127.0.0.1:3000/features/print-regression", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Print prescription" }).click();
await page.waitForFunction(() => window.__qaPrintCalls === 1);

const staged = await page.evaluate(() => {
  const portal = document.querySelector("body > [data-print-only]");
  const root = document.querySelector("[data-print-root]");
  if (!portal || !root) throw new Error("print DOM missing before print");
  const ps = getComputedStyle(portal);
  const rs = getComputedStyle(root);
  const pr = portal.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const hiddenBodyChildren = [...document.body.children]
    .filter((el) => !el.hasAttribute("data-print-only"))
    .map((el) => getComputedStyle(el).display);
  return {
    bodyStage: document.body.getAttribute("data-prescription-printing"),
    portalDisplay: ps.display,
    portalPosition: ps.position,
    portalVisibility: ps.visibility,
    portalRect: { x: pr.x, y: pr.y, width: pr.width, height: pr.height },
    rootDisplay: rs.display,
    rootVisibility: rs.visibility,
    rootRect: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
    rootText: root.textContent ?? "",
    hiddenBodyChildren,
  };
});
if (staged.bodyStage !== "true") throw new Error(`${label}: pre-print staging flag missing`);
if (staged.portalDisplay === "none" || staged.rootDisplay === "none") throw new Error(`${label}: staged print tree is display:none`);
if (staged.portalVisibility !== "visible" || staged.rootVisibility !== "visible") throw new Error(`${label}: staged print tree is not visibly paintable`);
if (staged.portalPosition !== "static") throw new Error(`${label}: staged portal is not in normal flow`);
if (staged.portalRect.x < -1 || staged.portalRect.y < -1 || staged.rootRect.x < -1 || staged.rootRect.y < -1) throw new Error(`${label}: staged tree is outside page origin`);
if (staged.rootRect.width <= 0 || staged.rootRect.height <= 0) throw new Error(`${label}: staged root has zero dimensions`);
if (!staged.rootText.includes("Test Patient") || !staged.rootText.includes("Napa 500 mg")) throw new Error(`${label}: staged clinical text missing`);
if (!staged.hiddenBodyChildren.every((display) => display === "none")) throw new Error(`${label}: app shell remains visible during staging`);
console.log(`${label.toUpperCase()}_STAGED_STATE`, JSON.stringify(staged));

await page.emulateMedia({ media: "print" });
const state = await page.evaluate(() => {
  const portal = document.querySelector("body > [data-print-only]");
  const root = document.querySelector("[data-print-root]");
  if (!portal || !root) throw new Error("print DOM missing under print media");
  const ps = getComputedStyle(portal);
  const rs = getComputedStyle(root);
  const pr = portal.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const hiddenBodyChildren = [...document.body.children]
    .filter((el) => !el.hasAttribute("data-print-only"))
    .map((el) => getComputedStyle(el).display);
  return {
    portalDisplay: ps.display,
    portalPosition: ps.position,
    portalLeft: ps.left,
    portalTop: ps.top,
    portalVisibility: ps.visibility,
    portalRect: { x: pr.x, y: pr.y, width: pr.width, height: pr.height },
    rootDisplay: rs.display,
    rootVisibility: rs.visibility,
    rootRect: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
    rootText: root.textContent ?? "",
    hiddenBodyChildren,
  };
});
if (state.portalDisplay === "none" || state.rootDisplay === "none") throw new Error(`${label}: printable tree is display:none`);
if (state.portalVisibility !== "visible" || state.rootVisibility !== "visible") throw new Error(`${label}: printable tree is not visible`);
if (state.portalRect.x < -1 || state.portalRect.y < -1 || state.rootRect.x < -1 || state.rootRect.y < -1) throw new Error(`${label}: printable tree is outside page`);
if (state.rootRect.width <= 0 || state.rootRect.height <= 0) throw new Error(`${label}: printable root has zero dimensions`);
if (!state.rootText.includes("Test Patient") || !state.rootText.includes("Napa 500 mg")) throw new Error(`${label}: clinical text missing`);
if (!state.hiddenBodyChildren.every((display) => display === "none")) throw new Error(`${label}: app shell is not excluded`);
console.log(`${label.toUpperCase()}_PRINT_STATE`, JSON.stringify(state));

const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, format: "A4" });
writeFileSync(`/tmp/m2-print-${label}.pdf`, pdf);
console.log(`${label.toUpperCase()}_PDF_BYTES=${pdf.length}`);
await browser.close();
