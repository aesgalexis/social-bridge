import crypto from "node:crypto";

export const SEALED_FORMAT = "social-bridge-sealed-v1";
const ALGORITHM = "RSA-OAEP-256+A256GCM";
const MAX_CIPHERTEXT_LENGTH = 25 * 1024 * 1024;
const FIELDS = ["format", "algorithm", "encryptedKey", "iv", "tag", "ciphertext"];

function decodeBase64(value, field, maxChars = MAX_CIPHERTEXT_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid sealed envelope field: " + field);
  }
  return Buffer.from(value, "base64");
}

export function validateSealedEnvelope(envelope) {
  if (!envelope || Array.isArray(envelope) || typeof envelope !== "object") {
    throw new Error("Sealed request must be an object");
  }
  if (Object.keys(envelope).sort().join(",") !== [...FIELDS].sort().join(",")) {
    throw new Error("Unexpected sealed envelope fields");
  }
  if (envelope.format !== SEALED_FORMAT || envelope.algorithm !== ALGORITHM) {
    throw new Error("Unsupported sealed request version");
  }
  const encryptedKey = decodeBase64(envelope.encryptedKey, "encryptedKey", 1024);
  const iv = decodeBase64(envelope.iv, "iv", 64);
  const tag = decodeBase64(envelope.tag, "tag", 64);
  const ciphertext = decodeBase64(envelope.ciphertext, "ciphertext");
  if (encryptedKey.length < 256 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid sealed envelope sizes");
  }
  return { encryptedKey, iv, tag, ciphertext };
}

export function sealRequest(request, publicKey) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(request), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = {
    format: SEALED_FORMAT,
    algorithm: ALGORITHM,
    encryptedKey: crypto.publicEncrypt({
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    }, key).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
  validateSealedEnvelope(envelope);
  return envelope;
}

export function openSealedRequest(envelope, privateKey) {
  const { encryptedKey, iv, tag, ciphertext } = validateSealedEnvelope(envelope);
  if (!privateKey) throw new Error("Missing LINKEDIN_OUTBOX_PRIVATE_KEY");
  try {
    const key = crypto.privateDecrypt({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    }, encryptedKey);
    if (key.length !== 32) throw new Error("Incorrect key size");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Could not decrypt or authenticate sealed request");
  }
}
