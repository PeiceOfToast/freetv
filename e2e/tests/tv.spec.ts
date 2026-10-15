import { expect, test } from "@playwright/test";
import { expectVideoPlaying } from "./support.ts";

// 10-foot UI: everything here is keyboard only, the way a TV remote drives it.

const focusLabel = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "none";
    const r = el.getBoundingClientRect();
    return `${el.getAttribute("aria-label") ?? el.textContent ?? el.tagName}@${Math.round(r.left)},${Math.round(r.top)}`;
  });

test.describe("tv mode", () => {
  test("arrow keys move focus, Enter opens a channel, Escape goes back", async ({ page }) => {
    await page.goto("/tv");
    await expect(page.getByTestId("tv-home")).toBeVisible();
    // Wait for a real channel tile: the favourites row shows a call-to-action tile first, which opens /tv/browse.
    await expect(page.locator(".tv-tile:not(.tv-tile-cta)").first()).toBeVisible({ timeout: 20_000 });

    // Tab into the page, then arrow around.
    await page.keyboard.press("Tab");
    const start = await focusLabel(page);
    await page.keyboard.press("ArrowRight");
    const afterRight = await focusLabel(page);
    expect(afterRight).not.toBe(start);
    await page.keyboard.press("ArrowDown");
    const afterDown = await focusLabel(page);
    expect(afterDown).not.toBe(afterRight);

    // Tab forward to a channel tile, then Enter.
    for (let i = 0; i < 60; i++) {
      const isChannel = await page.evaluate(() => document.activeElement?.matches(".tv-tile:not(.tv-tile-cta)") ?? false);
      if (isChannel) break;
      await page.keyboard.press("Tab");
    }
    await expect(page.locator(".tv-tile:not(.tv-tile-cta):focus")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tv\/watch\/[^/]+$/);
    await expect(page.getByTestId("tv-watch")).toBeVisible();

    // Back goes to the screen we came from.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/tv\/?$/);
  });

  test("the watch screen shows the channel overlay and plays", async ({ page }) => {
    await page.goto("/tv/watch/BBCNews.uk");
    const overlay = page.locator(".tv-info");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("BBC News");
    await expect(overlay).toContainText("Now:");
    await expectVideoPlaying(page);
  });
});
