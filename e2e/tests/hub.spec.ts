import { expect, test } from "@playwright/test";
import { CHANNELS } from "./support.ts";

// Hub mode: a channel the browser cannot play is handed to the viewer's own app ("Open in app", a
// one-channel M3U from /api/channels/:id/playlist.m3u). Desktop only (see MOBILE_SPECS).
// Written against docs/API.md. Assertions that need UI not built yet are test.fixme, not deleted.

/** Fixture channel whose only streams are on /dead/* (the fake origin answers 404). See setup/fixture-data.ts. */
const DEAD = "Akaku53.us";

test.describe("hub mode", () => {
  test("the watch page offers Open in app", async ({ page }) => {
    await page.goto(`/watch/${CHANNELS.bbc}`);
    await expect(
      page.getByRole("link", { name: /open in app/i }).or(page.getByRole("button", { name: /open in app/i })).first(),
    ).toBeVisible();
  });

  test("the per-channel M3U returns 200 with origin URLs and no relay", async ({ request }) => {
    const res = await request.get(`/api/channels/${CHANNELS.bbc}/playlist.m3u`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.text();
    expect(body.startsWith("#EXTM3U")).toBe(true);
    // Every stream of the channel, as the origin's own URLs (the fake HLS origin), never /proxy/ URLs.
    expect(body).toContain("/live/master.m3u8");
    expect(body).not.toContain("/proxy/");
  });

  test("browse playable=app returns 200 and only channels the browser cannot play", async ({ request }) => {
    const res = await request.get("/api/channels?playable=app&limit=200");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { total: number; items: { id: string; browserPlayable: boolean | null }[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(item.browserPlayable, item.id).not.toBe(true);
  });

  test("the playable=app filter survives a search in the browse URL", async ({ page }) => {
    await page.goto("/?playable=app");
    await expect(page.getByRole("heading", { name: "Browse channels" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]playable=app\b/);
    await page.getByRole("searchbox", { name: "Search channels" }).fill("cnn");
    await expect(page).toHaveURL(/[?&]q=cnn/);
    await expect(page).toHaveURL(/[?&]playable=app\b/);
  });

  test("a channel whose streams are all dead shows the failure panel", async ({ page }) => {
    await page.goto(`/watch/${DEAD}`);
    await expect(page.getByText("Couldn't play this channel")).toBeVisible({ timeout: 60_000 });
  });

  // NOTE: the failure panel does not offer "Open in app" yet (Player.tsx exhausted state). Enable once the
  // hub UI lands; this is the only assertion of the panel hint that is pending.
  test("the failure panel offers Open in app", async ({ page }) => {
    await page.goto(`/watch/${DEAD}`);
    const panel = page.locator("div", { hasText: "Couldn't play this channel" }).last();
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole("link", { name: /open in app/i }).or(panel.getByRole("button", { name: /open in app/i }))).toBeVisible();
  });
});
