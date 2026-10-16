import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { b64url, signPayload, SEGMENT_GRACE_SECONDS, MAX_EXP_AHEAD_SECONDS } from "../src/sign.js";
import type { ProxyServer } from "../src/server.js";
import { startProxy, startUpstream, closeServer, signed, nowSec, SEG, UA, REFERER, SECRET, PUBLIC_PATH, type SeenRequest } from "./helpers.js";

let upstream: Server;
let up = "";
let seen: SeenRequest[];
let proxy: ProxyServer;
let origin = "";

before(async () => {
  const u = startUpstream();
  upstream = u.server;
  seen = u.seen;
  const port = await u.ready;
  up = `http://127.0.0.1:${port}`;
  ({ proxy, origin } = await startProxy());
});

after(async () => {
  await proxy.close();
  await closeServer(upstream);
});

/** A correctly signed URL whose payload has no exp (what the api used to issue). */
function withoutExp(u: string): string {
  const payload = b64url(JSON.stringify({ u }));
  return `${PUBLIC_PATH}/${signPayload(SECRET, payload)}/${payload}`;
}

const decodeExp = (path: string) => {
  const payload = path.split("/").pop() as string;
  return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number }).exp;
};

describe("expiry", () => {
  it("an expired playlist is refused with 403 expired", async () => {
    const res = await fetch(`${origin}${signed(`${up}/real/media/index.m3u8`, UA, REFERER, nowSec() - 1)}`);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "expired" });
  });

  it("a playlist within exp is served", async () => {
    const res = await fetch(`${origin}${signed(`${up}/real/media/index.m3u8`, UA, REFERER, nowSec() + 3600)}`);
    assert.equal(res.status, 200);
  });

  it("a segment shortly after exp is served (grace period)", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`, null, null, nowSec() - 60)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), SEG);
  });

  it("a segment past the grace period is refused with 403 expired", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`, null, null, nowSec() - SEGMENT_GRACE_SECONDS - 60)}`);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "expired" });
  });

  it("a payload without exp is refused with 403 expired, for playlists and segments", async () => {
    for (const target of [`${up}/real/media/index.m3u8`, `${up}/seg.bin`]) {
      const res = await fetch(`${origin}${withoutExp(target)}`);
      assert.equal(res.status, 403, target);
      assert.deepEqual(await res.json(), { error: "expired" }, target);
    }
  });

  it("an exp more than 30 days ahead is refused with 403 invalid expiry", async () => {
    const res = await fetch(`${origin}${signed(`${up}/seg.bin`, null, null, nowSec() + MAX_EXP_AHEAD_SECONDS + 3600)}`);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "invalid expiry" });
  });

  it("a non-integer exp is an invalid payload (400)", async () => {
    const payload = b64url(JSON.stringify({ u: `${up}/seg.bin`, exp: 1.5 }));
    const res = await fetch(`${origin}${PUBLIC_PATH}/${signPayload(SECRET, payload)}/${payload}`);
    assert.equal(res.status, 400);
  });

  it("rewritten child URLs carry the parent's exp, for variants and segments alike", async () => {
    const exp = nowSec() + 3600;
    const master = await fetch(`${origin}${signed(`${up}/redir/master.m3u8`, UA, REFERER, exp)}`);
    assert.equal(master.status, 200);
    const text = await master.text();
    const children = [...text.matchAll(/\/proxy\/[^/\s"]+\/[^/\s"]+/g)].map((m) => m[0]);
    assert.ok(children.length >= 3, "master rewrites variants, audio and session key");
    for (const child of children) assert.equal(decodeExp(child), exp, child);

    const decodeU = (path: string) => (JSON.parse(Buffer.from(path.split("/").pop() as string, "base64url").toString("utf8")) as { u: string }).u;
    const mediaPath = children.find((c) => decodeU(c) === `${up}/real/media/index.m3u8`);
    assert.ok(mediaPath, "the media variant is rewritten");
    const media = await fetch(`${origin}${mediaPath}`);
    assert.equal(media.status, 200);
    const mediaText = await media.text();
    const segs = [...mediaText.matchAll(/\/proxy\/[^/\s"]+\/[^/\s"]+/g)].map((m) => m[0]);
    assert.ok(segs.length >= 2);
    for (const s of segs) assert.equal(decodeExp(s), exp, s);
  });

  it("an expired parent is refused before any upstream request, so no children are issued", async () => {
    const before = seen.length;
    const res = await fetch(`${origin}${signed(`${up}/real/master.m3u8`, UA, REFERER, nowSec() - 1)}`);
    assert.equal(res.status, 403);
    assert.equal(seen.length, before);
  });
});
