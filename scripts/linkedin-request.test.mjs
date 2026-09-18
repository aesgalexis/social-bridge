import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateLinkedInRequest } from "./lib/linkedin-request.mjs";

const NOW = Date.parse("2026-09-18T07:00:00Z");

function makeRequest(overrides = {}) {
  return {
    publish: true,
    text: "Hello LinkedIn",
    ...overrides
  };
}

test("accepts a minimal text request", () => {
  const result = validateLinkedInRequest(makeRequest(), { nowMs: NOW });
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.text, "Hello LinkedIn");
});

test("rejects unknown top-level keys", () => {
  const result = validateLinkedInRequest(makeRequest({ publsihAt: "typo" }), {
    nowMs: NOW
  });
  assert.match(result.errors.join("\n"), /unknown top-level key: publsihAt/);
});

test("requires an explicit timezone in publishAt", () => {
  const result = validateLinkedInRequest(
    makeRequest({ publishAt: "2026-09-20T09:30:00" }),
    { nowMs: NOW }
  );
  assert.match(result.errors.join("\n"), /explicit timezone/);
});

test("push mode rejects a very old publishAt", () => {
  const result = validateLinkedInRequest(
    makeRequest({ publishAt: "2026-07-01T09:30:00Z" }),
    { mode: "push", nowMs: NOW }
  );
  assert.match(result.errors.join("\n"), /more than 30 days in the past/);
});

test("scheduler mode does not age out durable historical entries", () => {
  const result = validateLinkedInRequest(
    makeRequest({ publishAt: "2026-07-01T09:30:00Z" }),
    { mode: "schedule", nowMs: NOW }
  );
  assert.deepEqual(result.errors, []);
});

test("repository validation does not become invalid as entries age", () => {
  const result = validateLinkedInRequest(
    makeRequest({ publishAt: "2026-07-01T09:30:00Z" }),
    { mode: "repository", nowMs: NOW }
  );
  assert.deepEqual(result.errors, []);
});

test("push mode rejects schedules more than 366 days ahead", () => {
  const result = validateLinkedInRequest(
    makeRequest({ publishAt: "2028-01-01T09:30:00Z" }),
    { mode: "push", nowMs: NOW }
  );
  assert.match(result.errors.join("\n"), /more than 366 days in the future/);
});

test("rejects image paths outside media/linkedin", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "social-bridge-test-"));
  fs.mkdirSync(path.join(cwd, "media/linkedin"), { recursive: true });

  const result = validateLinkedInRequest(
    makeRequest({ image: { path: "../outside.png" } }),
    { cwd, nowMs: NOW }
  );

  assert.match(result.errors.join("\n"), /must stay under media\/linkedin/);
});

test("rejects image symlinks that escape media/linkedin", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "social-bridge-test-"));
  const mediaDir = path.join(cwd, "media/linkedin");
  fs.mkdirSync(mediaDir, { recursive: true });

  const outside = path.join(cwd, "outside.png");
  fs.writeFileSync(outside, "not really an image");

  const link = path.join(mediaDir, "escape.png");
  try {
    fs.symlinkSync(outside, link);
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }

  const result = validateLinkedInRequest(
    makeRequest({ image: { path: "media/linkedin/escape.png" } }),
    { cwd, nowMs: NOW }
  );

  assert.match(result.errors.join("\n"), /must not escape/);
});

test("accepts an existing supported image and normalizes alt text", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "social-bridge-test-"));
  const mediaDir = path.join(cwd, "media/linkedin");
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, "test.png"), "fake png bytes");

  const result = validateLinkedInRequest(
    makeRequest({
      image: {
        path: "media/linkedin/test.png",
        altText: "  test image  "
      }
    }),
    { cwd, nowMs: NOW }
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.value.image.contentType, "image/png");
  assert.equal(result.value.image.altText, "test image");
});

test("rejects non-string alt text", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "social-bridge-test-"));
  const mediaDir = path.join(cwd, "media/linkedin");
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, "test.png"), "fake png bytes");

  const result = validateLinkedInRequest(
    makeRequest({
      image: {
        path: "media/linkedin/test.png",
        altText: 123
      }
    }),
    { cwd, nowMs: NOW }
  );

  assert.match(result.errors.join("\n"), /altText must be a string/);
});
