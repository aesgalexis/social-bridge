import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { openSealedRequest, sealRequest, validateSealedEnvelope } from "./lib/sealed-outbox.mjs";
import { validateLinkedInRequest } from "./lib/linkedin-request.mjs";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
const original = {
  publish: true,
  publishAt: "2026-11-10T11:00:00Z",
  text: "Confidential unpublished draft",
  image: { contentType: "image/png", data: Buffer.from("test").toString("base64"), altText: "A test" }
};

test("sealed request round trips without exposing post content", () => {
  const envelope = sealRequest(original, publicKey);
  assert.deepEqual(openSealedRequest(envelope, privateKey), original);
  assert.doesNotMatch(JSON.stringify(envelope), /Confidential unpublished draft/);
  assert.deepEqual(
    validateLinkedInRequest(openSealedRequest(envelope, privateKey), {
      mode: "schedule", sealed: true
    }).errors,
    []
  );
});

test("modified ciphertext or tag fails authentication", () => {
  const altered = { ...sealRequest(original, publicKey), tag: Buffer.alloc(16, 1).toString("base64") };
  assert.throws(() => openSealedRequest(altered, privateKey), /decrypt or authenticate/);
});

test("missing private key fails closed", () => {
  assert.throws(() => openSealedRequest(sealRequest(original, publicKey), ""), /Missing/);
});

test("rejects plaintext requests and unknown envelope fields", () => {
  assert.throws(() => validateSealedEnvelope({ publish: true, text: "leak" }), /fields/);
  assert.throws(() => validateSealedEnvelope({ ...sealRequest(original, publicKey), text: "leak" }), /fields/);
});

test("rejects malformed embedded image payload", () => {
  const result = validateLinkedInRequest({
    ...original,
    image: { contentType: "image/png", data: "bad?", altText: "x" }
  }, { mode: "schedule", sealed: true });
  assert.match(result.errors.join("\n"), /base64/);
});

test("legacy raw image path is not accepted in a sealed request", () => {
  const result = validateLinkedInRequest({
    publish: true, text: "hello", image: { path: "media/linkedin/photo.png" }
  }, { mode: "schedule", sealed: true });
  assert.match(result.errors.join("\n"), /image.data/);
});
