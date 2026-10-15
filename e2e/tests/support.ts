import { expect, type Page } from "@playwright/test";

export const CHANNELS = {
  bbc: "BBCNews.uk",
  cnn: "CNN.us",
  aljazeera: "AlJazeera.qa",
} as const;

/** Writes localStorage on the app origin. Call before the page reads favorites or view mode. */
export async function seedLocalStorage(page: Page, values: Record<string, string>) {
  await page.goto("/about");
  await page.evaluate((v) => {
    for (const [k, val] of Object.entries(v)) localStorage.setItem(k, val);
  }, values);
}

/** Resolves once a <video> is decoding frames: readyState >= HAVE_FUTURE_DATA and time moving. */
export async function expectVideoPlaying(page: Page) {
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && v.readyState >= 3 && v.currentTime > 0;
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  );
}

/** Records every request URL the page makes (including the service worker's). */
export function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

/** The filter UI is a sidebar on desktop and a drawer on phones. Returns the scope holding the chips. */
export async function filterScope(page: Page) {
  const sidebar = page.locator("aside#browse-sidebar");
  if (await sidebar.isVisible()) return sidebar;
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Filters" });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** The result region on the browse page (the filter sidebar has lists of its own). */
export const results = (page: Page) => page.getByRole("region", { name: "Results" });

/** Channel cards, in display order. */
export const resultItems = (page: Page) => results(page).locator("ul > li");

/** Total shown by the browse toolbar, e.g. "123 channels". */
export async function channelTotal(page: Page): Promise<number> {
  // Waits through "Loading channels…" so callers always get a number.
  const label = results(page).locator('[aria-live="polite"] p').first();
  await expect(label).toContainText(/\d[\d,]* channels?/);
  const text = (await label.innerText()).replace(/,/g, "");
  const m = /(\d+)\s+channels?/.exec(text);
  if (!m) throw new Error(`no channel total in "${text}"`);
  return Number(m[1]);
}
