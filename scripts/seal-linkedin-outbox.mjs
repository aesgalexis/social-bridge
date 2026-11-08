import fs from "node:fs";
import path from "node:path";
import { assertValidLinkedInRequest } from "./lib/linkedin-request.mjs";
import { sealRequest } from "./lib/sealed-outbox.mjs";

const [source, destination] = process.argv.slice(2);
if (!source || !destination || !destination.endsWith(".sealed.json")) {
  throw new Error("Usage: node scripts/seal-linkedin-outbox.mjs drafts/post.json outbox/linkedin/name.sealed.json");
}
const outboxRoot = path.resolve("outbox/linkedin");
const destPath = path.resolve(destination);
if (path.dirname(destPath) !== outboxRoot) {
  throw new Error("Sealed output must be directly under outbox/linkedin/");
}
if (fs.existsSync(destPath)) throw new Error("Refusing to overwrite existing sealed delivery");
const sourcePath = path.resolve(source);
if (sourcePath.startsWith(outboxRoot + path.sep)) {
  throw new Error("Plaintext drafts must not be stored in the GitHub outbox");
}
const request = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const validated = assertValidLinkedInRequest(request, { mode: "push" });
const sealedRequest = {
  publish: true,
  text: validated.text,
  ...(validated.publishAt ? { publishAt: validated.publishAt.toISOString() } : {}),
  ...(validated.image ? {
    image: {
      contentType: validated.image.contentType,
      data: fs.readFileSync(validated.image.absolutePath).toString("base64"),
      ...(validated.image.altText ? { altText: validated.image.altText } : {})
    }
  } : {})
};
const publicKey = fs.readFileSync("config/outbox-public.pem", "utf8");
const envelope = sealRequest(sealedRequest, publicKey);
fs.writeFileSync(destPath, JSON.stringify(envelope, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log("Created encrypted LinkedIn request:", destination);
