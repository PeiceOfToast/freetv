import { expect, test } from "@playwright/test";

test.describe("exports", () => {
  test("the M3U playlist lists a favourite once, with its tvg-id", async ({ request }) => {
    const res = await request.get("/api/playlist.m3u?favorites=BBCNews.uk");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("mpegurl");
    const body = await res.text();
    expect(body.startsWith("#EXTM3U")).toBe(true);
    const extinf = body.split("\n").filter((line) => line.startsWith("#EXTINF"));
    expect(extinf).toHaveLength(1);
    expect(extinf[0]).toContain('tvg-id="BBCNews.uk"');
  });

  test("the XMLTV guide is served as XML", async ({ request }) => {
    const res = await request.get("/api/guide.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/xml/);
    const body = await res.text();
    expect(body).toMatch(/^<\?xml/);
    expect(body).toContain('channel="BBCNews.uk"');
  });
});
