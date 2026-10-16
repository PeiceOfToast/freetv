import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  TargetForbiddenError,
  assertPublicTarget,
  guardedFetch,
  guardedLookup,
  isBlockedAddress,
  isBlockedHostname,
} from "../src/lib/ssrf.js";

describe("SSRF guard: address and hostname rules", () => {
  test("private, loopback, link-local, CGNAT, multicast and unspecified IPv4 are blocked", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "224.0.0.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  test("public IPv4 addresses are allowed, including the edges of the private ranges", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.128.0.1", "203.0.113.5"]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });

  test("IPv6 loopback, unspecified, unique-local, link-local and NAT64 are blocked; public IPv6 is allowed", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "64:ff9b::7f00:1"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
  });

  test("IPv4-mapped IPv6 is unwrapped and judged as IPv4", () => {
    assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedAddress("::ffff:7f00:1"), true, "hex form of 127.0.0.1");
    assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
    assert.equal(isBlockedAddress("::ffff:808:808"), false, "hex form of 8.8.8.8");
  });

  test("things that are not IP addresses are blocked by isBlockedAddress", () => {
    assert.equal(isBlockedAddress("example.com"), true);
  });

  test("localhost, metadata host and internal suffixes are blocked by name", () => {
    for (const h of ["localhost", "LOCALHOST.", "metadata.google.internal", "box.local", "svc.internal", "a.localhost"]) {
      assert.equal(isBlockedHostname(h), true, h);
    }
    assert.equal(isBlockedHostname("iptv-org.github.io"), false);
  });
});

describe("SSRF guard: target checks", () => {
  const savedAllow = config.fetchAllowPrivate;
  before(() => {
    config.fetchAllowPrivate = false;
  });
  after(() => {
    config.fetchAllowPrivate = savedAllow;
  });

  test("non-http schemes are refused even with private targets allowed", async () => {
    await assert.rejects(assertPublicTarget(new URL("file:///etc/passwd"), true), TargetForbiddenError);
    await assert.rejects(assertPublicTarget(new URL("ftp://8.8.8.8/x"), true), TargetForbiddenError);
  });

  test("with the guard on, literal private IPs and blocked names are refused without DNS", async () => {
    await assert.rejects(assertPublicTarget(new URL("http://127.0.0.1:8080/x"), false), TargetForbiddenError);
    await assert.rejects(assertPublicTarget(new URL("http://[::1]/x"), false), TargetForbiddenError);
    await assert.rejects(assertPublicTarget(new URL("http://169.254.169.254/latest/"), false), TargetForbiddenError);
    await assert.rejects(assertPublicTarget(new URL("http://localhost:3000/"), false), TargetForbiddenError);
  });

  test("a hostname that resolves to loopback is refused by the resolved-address check", async () => {
    await assert.rejects(assertPublicTarget(new URL("http://localhost/x"), false), TargetForbiddenError);
  });

  test("FETCH_ALLOW_PRIVATE=true (allowPrivate) lets private targets through the pre-check", async () => {
    await assertPublicTarget(new URL("http://127.0.0.1:1/x"), true);
    await assertPublicTarget(new URL("http://169.254.169.254/"), true);
  });

  test("guardedLookup refuses a name that resolves to loopback, at connect time", async () => {
    const err = await new Promise<Error | null>((resolve) => {
      guardedLookup("localhost", { all: true }, (e) => resolve(e));
    });
    assert.ok(err instanceof TargetForbiddenError, "expected TargetForbiddenError");
  });

  test("guardedLookup returns the address for a public literal when all=false", async () => {
    const got = await new Promise<{ err: Error | null; address?: unknown; family?: number }>((resolve) => {
      guardedLookup("8.8.8.8", {}, (err, address, family) => resolve({ err, address, family }));
    });
    assert.equal(got.err, null);
    assert.equal(got.address, "8.8.8.8");
    assert.equal(got.family, 4);
  });

  test("guardedFetch with the guard on never connects to a private literal", async () => {
    await assert.rejects(guardedFetch(new URL("http://127.0.0.1:1/"), {}), (err: unknown) => {
      assert.ok(err instanceof TargetForbiddenError);
      return true;
    });
  });
});
