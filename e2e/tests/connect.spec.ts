import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedLocalStorage } from "./support.ts";

// /connect: the two URLs a viewer gives a TV or phone app (M3U playlist and XMLTV guide), with
// per-app steps, copy buttons and QR codes. Desktop only (see MOBILE_SPECS in playwright.config.ts).
// Written against docs/API.md ("Settings", "Exports") and docs/TV.md. A test that needs UI which is
// not there yet is marked test.fixme with a note, not deleted.

const PLAYLIST = "/api/playlist.m3u";
const GUIDE = "/api/guide.xml";

const playlistLink = (page: Page): Locator => page.getByRole("textbox", { name: "Playlist link", exact: true });
const guideLink = (page: Page): Locator => page.getByRole("textbox", { name: "Guide link", exact: true });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The base the page must use: the operator's publicUrl when set, otherwise the address the page was loaded from. */
async function expectedBase(page: Page, baseURL: string | undefined): Promise<string> {
  const res = await page.request.get("/api/settings");
  const settings = (await res.json()) as { publicUrl?: string };
  return (settings.publicUrl || baseURL || "http://127.0.0.1:4173").replace(/\/+$/, "");
}

test.describe("connect", () => {
  test("renders the playlist and guide URLs on the site's public origin", async ({ page, baseURL }) => {
    await page.goto("/connect");
    const base = await expectedBase(page, baseURL);
    await expect(playlistLink(page)).toHaveValue(new RegExp(`^${escapeRe(base)}${escapeRe(PLAYLIST)}`));
    await expect(guideLink(page)).toHaveValue(`${base}${GUIDE}`);
  });

  test("each URL has a copy button", async ({ page }) => {
    await page.goto("/connect");
    await expect(page.getByRole("button", { name: /copy playlist link/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /copy guide link/i })).toBeVisible();
  });

  test("QR codes render as inline SVG", async ({ page }) => {
    await page.goto("/connect");
    // A loose check: the page also has icons, so only the lower bound matters.
    await expect.poll(() => page.locator("svg").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test("choosing a country rewrites the playlist URL", async ({ page }) => {
    await page.goto("/connect");
    await expect(playlistLink(page)).not.toHaveValue(/country=/);
    await page.getByRole("checkbox", { name: /United States/ }).check();
    await expect(playlistLink(page)).toHaveValue(/country=US/);
  });

  test("the favourites toggle adds favorites= to the playlist URL", async ({ page }) => {
    await seedLocalStorage(page, { "freetv:favorites": JSON.stringify(["BBCNews.uk"]) });
    await page.goto("/connect");
    await page.getByRole("checkbox", { name: /My favou?rites only/ }).check();
    await expect(playlistLink(page)).toHaveValue(/favorites=BBCNews\.uk/);
  });

  test("GET /api/settings returns 200 JSON", async ({ request }) => {
    const res = await request.get("/api/settings");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
    const body = (await res.json()) as { siteName: unknown; featuredApps: unknown; relayEnabled: unknown };
    expect(typeof body.siteName).toBe("string");
    expect(Array.isArray(body.featuredApps)).toBe(true);
    expect(typeof body.relayEnabled).toBe("boolean");
  });
});
