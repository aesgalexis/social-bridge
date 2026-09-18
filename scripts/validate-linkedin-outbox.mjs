import fs from "node:fs";
import path from "node:path";
import { validateLinkedInRequest } from "./lib/linkedin-request.mjs";

const OUTBOX_ROOT = path.resolve(process.cwd(), "outbox/linkedin");

function validateEntry(filePath) {
  let request;

  try {
    request = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return [`invalid JSON: ${error.message}`];
  }

  return validateLinkedInRequest(request, { mode: "repository" }).errors;
}

if (!fs.existsSync(OUTBOX_ROOT)) {
  throw new Error("outbox/linkedin directory is missing");
}

const entries = fs
  .readdirSync(OUTBOX_ROOT)
  .filter((name) => name.endsWith(".json"))
  .sort();

let failures = 0;

for (const name of entries) {
  const filePath = path.join(OUTBOX_ROOT, name);
  const errors = validateEntry(filePath);

  if (errors.length === 0) {
    console.log(`OK ${name}`);
    continue;
  }

  failures += 1;
  console.error(`INVALID ${name}`);
  for (const error of errors) console.error(`  - ${error}`);
}

if (failures > 0) {
  throw new Error(`${failures} LinkedIn outbox entr${failures === 1 ? "y" : "ies"} failed validation`);
}

console.log(`Validated ${entries.length} LinkedIn outbox entr${entries.length === 1 ? "y" : "ies"}.`);
