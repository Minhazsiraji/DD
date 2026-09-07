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

const screen = await page.evaluate(() => {
  const portal = document.querySelector("body > [data-print-only]");
  const root = document.querySelector("[data-print-root]");
  if (!portal || !root) throw new Error("print DOM missing before print");
  const ps = getComputedStyle(portal);
  const rr = root.getBoundingClientRect();
  return {
    portalPosition: ps.position,
    portalLeft: ps.left,
    rootRect: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
    text: root.textContent ?? "",
  };
});
if (screen.rootRect.width <= 0 || screen.rootRect.height <= 0) throw new Error(`${label}: screen print root has zero dimensions`);
if (!screen.text.includes("Test Patient") || !screen.text.includes("Napa 500 mg")) throw new Error(`${label}: clinical text missing before print`);
console.log(`${label.toUpperCase()}_SCREEN_STATE`, JSON.stringify(screen));

await page.emulateMedia({ media: "print" });
const state = await page.evaluate(() => {
  const portal = document.querySelector("body > [data-print-only]");
  const root = document.querySelector("[data-print-root]");
  if (!portal || !root) throw new Error("print DOM missing under print media");
  const ps = getComputedStyle(portal);
  const rs = getComputedStyle(root);
  const rr = root.getBoundingClientRect();
  const before = getComputedStyle(document.body, "::before");
  const hiddenBodyChildren = [...document.body.children]
    .filter((el) => !el.hasAttribute("data-print-only"))
    .map((el) => getComputedStyle(el).display);
  return {
    portalDisplay: ps.display,
    portalPosition: ps.position,
    portalLeft: ps.left,
    portalTop: ps.top,
    portalVisibility: ps.visibility,
    rootDisplay: rs.display,
    rootVisibility: rs.visibility,
    rootColor: rs.color,
    rootRect: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
    rootText: root.textContent ?? "",
    bodyPosition: getComputedStyle(document.body).position,
    bodyIsolation: getComputedStyle(document.body).isolation,
    bodyBeforeContent: before.content,
    bodyBeforeDisplay: before.display,
    hiddenBodyChildren,
  };
});

if (state.portalDisplay === "none" || state.rootDisplay === "none") throw new Error(`${label}: printable tree is display:none`);
if (state.rootVisibility !== "visible") throw new Error(`${label}: printable root is not visible`);
if (state.rootRect.x < -1 || state.rootRect.y < -1) throw new Error(`${label}: printable root is outside page: ${JSON.stringify(state)}`);
if (state.rootRect.width <= 0 || state.rootRect.height <= 0) throw new Error(`${label}: printable root has zero dimensions`);
if (!state.rootText.includes("Test Patient") || !state.rootText.includes("Napa 500 mg")) throw new Error(`${label}: clinical text missing under print media`);
if (!state.hiddenBodyChildren.every((display) => display === "none")) throw new Error(`${label}: app shell is not excluded`);
if (state.bodyPosition !== "static") throw new Error(`${label}: app canvas body positioning survived print`);
if (state.bodyIsolation !== "auto") throw new Error(`${label}: app canvas isolation survived print`);
if (state.bodyBeforeDisplay !== "none" && state.bodyBeforeContent !== "none") throw new Error(`${label}: organ background pseudo-element survived print`);
console.log(`${label.toUpperCase()}_PRINT_STATE`, JSON.stringify(state));

const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
writeFileSync(`/tmp/m2-print-${label}.pdf`, pdf);
console.log(`${label.toUpperCase()}_PDF_BYTES=${pdf.length}`);
await browser.close();
