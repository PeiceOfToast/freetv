import { expect, test } from "@playwright/test";

test.describe("pwa", () => {
  test("the web app manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name: string; display: string };
    expect(manifest.name).toBe("FreeTV");
    expect(manifest.display).toBe("standalone");
  });

  test("the service worker registers and activates", async ({ page }) => {
    await page.goto("/");
    const state = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await navigator.serviceWorker.ready;
      return reg.active ? "active" : "waiting";
    });
    expect(state).toBe("active");
  });
});
