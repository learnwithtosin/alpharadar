import { describe, expect, it } from "vitest";
import { looksLikePubliclyReachableHttpsUrl } from "./url-guard.js";

describe("looksLikePubliclyReachableHttpsUrl", () => {
  it("accepts a real https URL", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://alpharadar.app/opportunities/1")).toBe(true);
  });

  it("rejects http://localhost:3000 — the exact WEB_URL default that failed live", () => {
    expect(looksLikePubliclyReachableHttpsUrl("http://localhost:3000/opportunities/1")).toBe(false);
  });

  it("rejects https://localhost too — the scheme alone doesn't save it", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://localhost:3000")).toBe(false);
  });

  it("rejects a plain http:// URL even with a public hostname — https only", () => {
    expect(looksLikePubliclyReachableHttpsUrl("http://alpharadar.app")).toBe(false);
  });

  it("rejects IPv4 loopback", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://127.0.0.1:3000")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://0.0.0.0:3000")).toBe(false);
  });

  it("rejects private IPv4 ranges (10/8, 172.16/12, 192.168/16)", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://10.0.0.5")).toBe(false);
    expect(looksLikePubliclyReachableHttpsUrl("https://172.16.0.5")).toBe(false);
    expect(looksLikePubliclyReachableHttpsUrl("https://172.31.255.255")).toBe(false);
    expect(looksLikePubliclyReachableHttpsUrl("https://192.168.1.5")).toBe(false);
  });

  it("does not reject a public address merely because it's in the 172.x range but outside 172.16-31", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://172.64.0.1")).toBe(true);
  });

  it("rejects link-local IPv4 (169.254/16)", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://169.254.1.1")).toBe(false);
  });

  it("rejects IPv6 loopback and unspecified", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://[::1]:3000")).toBe(false);
    expect(looksLikePubliclyReachableHttpsUrl("https://[::]:3000")).toBe(false);
  });

  it("rejects IPv6 link-local (fe80::/10)", () => {
    expect(looksLikePubliclyReachableHttpsUrl("https://[fe80::1]:3000")).toBe(false);
  });

  it("rejects an unparseable URL rather than throwing", () => {
    expect(looksLikePubliclyReachableHttpsUrl("not a url")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(looksLikePubliclyReachableHttpsUrl("")).toBe(false);
  });
});
