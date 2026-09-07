import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.addInitScript(() => {
  window.__qaPrintCalls = 0;
  window.print = () => {
    window.__qaPrintCalls += 1;
    window.__qaPrintRequestedAt = performance.now();
  };
});

await page.goto("http://127.0.0.1:3000/features/print-regression", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Print prescription" }).click();
await page.waitForFunction(() => window.__qaPrintCalls === 1);

const mounted = await page.evaluate(() => ({
  portal: Boolean(document.querySelector("body > [data-print-only]")),
  root: Boolean(document.querySelector("[data-print-root]")),
  text: document.querySelector("[data-print-root]")?.textContent ?? "",
}));
console.log("SCREEN_MOUNT", JSON.stringify(mounted));

await page.emulateMedia({ media: "print" });
const state = await page.evaluate(() => {
  const portal = document.querySelector("body > [data-print-only]");
  const root = document.querySelector("[data-print-root]");
  const chrome = document.querySelector("[data-qa-app-chrome]");
  if (!portal || !root || !chrome) throw new Error("print DOM missing");
  const portalStyle = getComputedStyle(portal);
  const rootStyle = getComputedStyle(root);
  const portalRect = portal.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    portalDisplay: portalStyle.display,
    portalPosition: portalStyle.position,
    portalLeft: portalStyle.left,
    portalVisibility: portalStyle.visibility,
    portalRect: { x: portalRect.x, y: portalRect.y, width: portalRect.width, height: portalRect.height },
    rootDisplay: rootStyle.display,
    rootVisibility: rootStyle.visibility,
    rootRect: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
    rootText: root.textContent ?? "",
    chromeDisplay: getComputedStyle(chrome).display,
    bodyText: document.body.innerText,
  };
});
console.log("PRINT_STATE", JSON.stringify(state));

const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, format: "A4" });
writeFileSync("/tmp/m2-print-repro.pdf", pdf);
console.log(`PDF_BYTES=${pdf.length}`);

await browser.close();
