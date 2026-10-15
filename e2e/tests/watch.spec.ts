import { expect, test } from "@playwright/test";
import { CHANNELS, expectVideoPlaying, recordRequests } from "./support.ts";

test.describe("watch", () => {
  test("falls through dead and CORS-blocked direct streams to a working direct one", async ({ page }) => {
    const urls = recordRequests(page);
    await page.goto(`/watch/${CHANNELS.bbc}`);
    await expectVideoPlaying(page);

    // The player tried the dead URL and the CORS-blocked one before the good direct URL.
    expect(urls.some((u) => u.includes("/dead/master.m3u8"))).toBe(true);
    expect(urls.some((u) => u.includes("/cors-blocked/master.m3u8"))).toBe(true);
    expect(urls.some((u) => u.includes("/live/master.m3u8"))).toBe(true);
    // A direct stream worked, so the relay was never needed.
    expect(urls.some((u) => u.includes("/proxy/"))).toBe(false);
  });

  test("a CORS-blocked channel plays through the relay", async ({ page }) => {
    const urls = recordRequests(page);
    await page.goto(`/watch/${CHANNELS.cnn}`);
    await expectVideoPlaying(page);
    // Direct failed (no CORS on the origin), so the relay URL carried the playlist and segments.
    expect(urls.some((u) => u.includes("/cors-blocked/master.m3u8"))).toBe(true);
    expect(urls.some((u) => u.includes("/proxy/"))).toBe(true);
  });

  test("a channel whose only stream is direct plays without the relay", async ({ page }) => {
    const urls = recordRequests(page);
    await page.goto(`/watch/${CHANNELS.aljazeera}`);
    await expectVideoPlaying(page);
    expect(urls.some((u) => u.includes("/live/master.m3u8"))).toBe(true);
    expect(urls.some((u) => u.includes("/proxy/"))).toBe(false);
  });

  test("the status line reports the relay once it is playing", async ({ page }) => {
    await page.goto(`/watch/${CHANNELS.cnn}`);
    await expectVideoPlaying(page);
    await expect(page.getByText("Playing · relay")).toBeVisible();
  });
});
