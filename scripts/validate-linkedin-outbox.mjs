import fs from "node:fs";
import path from "node:path";

const OUTBOX_ROOT = path.resolve(process.cwd(), "outbox/linkedin");
const IMAGE_ROOT = path.resolve(process.cwd(), "media/linkedin");
const MAX_TEXT_LENGTH = 3000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ALT_TEXT_LENGTH = 4086;
const MAX_SCHEDULE_FUTURE_DAYS = 366;
const MAX_SCHEDULE_PAST_DAYS = 30;
const CONTENT_TYPES = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const ALLOWED_TOP_LEVEL_KEYS = new Set(["publish", "publishAt", "text", "image"]);
const ALLOWED_IMAGE_KEYS = new Set(["path", "altText"]);

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function validateEntry(filePath) {
  const errors = [];
  let request;

  try {
    request = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return [`invalid JSON: ${error.message}`];
  }

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return ["entry must be a JSON object"];
  }

  for (const key of Object.keys(request)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`unknown top-level key: ${key}`);
    }
  }

  if (request.publish !== true) {
    errors.push("publish must be true");
  }

  if (typeof request.text !== "string" || !request.text.trim()) {
    errors.push("text must be a non-empty string");
  } else if (request.text.trim().length > MAX_TEXT_LENGTH) {
    errors.push(`text exceeds ${MAX_TEXT_LENGTH} characters`);
  }

  if (request.publishAt !== undefined) {
    if (typeof request.publishAt !== "string") {
      errors.push("publishAt must be an ISO-8601 string");
    } else {
      const publishAt = new Date(request.publishAt);
      if (Number.isNaN(publishAt.getTime())) {
        errors.push("publishAt is not a valid ISO-8601 date/time");
      } else if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(request.publishAt)) {
        errors.push("publishAt must include an explicit timezone or Z");
      } else {
        const now = Date.now();
        const ts = publishAt.getTime();
        if (ts < now - daysToMs(MAX_SCHEDULE_PAST_DAYS)) {
          errors.push(
            `publishAt is more than ${MAX_SCHEDULE_PAST_DAYS} days in the past`
          );
        }
        if (ts > now + daysToMs(MAX_SCHEDULE_FUTURE_DAYS)) {
          errors.push(
            `publishAt is more than ${MAX_SCHEDULE_FUTURE_DAYS} days in the future`
          );
        }
      }
    }
  }

  if (request.image !== undefined) {
    if (!request.image || typeof request.image !== "object" || Array.isArray(request.image)) {
      errors.push("image must be an object");
      return errors;
    }

    for (const key of Object.keys(request.image)) {
      if (!ALLOWED_IMAGE_KEYS.has(key)) {
        errors.push(`unknown image key: ${key}`);
      }
    }

    if (typeof request.image.path !== "string" || !request.image.path.trim()) {
      errors.push("image.path is required");
      return errors;
    }

    const relativePath = request.image.path.replaceAll("\\", "/");
    const absolutePath = path.resolve(process.cwd(), relativePath);

    if (!absolutePath.startsWith(`${IMAGE_ROOT}${path.sep}`)) {
      errors.push("image.path must stay under media/linkedin/");
      return errors;
    }

    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      errors.push(`image file not found: ${relativePath}`);
      return errors;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    if (!CONTENT_TYPES.has(extension)) {
      errors.push("image must be JPG, PNG, or GIF");
    }

    const size = fs.statSync(absolutePath).size;
    if (size > MAX_IMAGE_BYTES) {
      errors.push(`image exceeds ${MAX_IMAGE_BYTES}-byte transport limit`);
    }

    if (
      request.image.altText !== undefined &&
      typeof request.image.altText !== "string"
    ) {
      errors.push("image.altText must be a string when provided");
    } else if (
      typeof request.image.altText === "string" &&
      request.image.altText.trim().length > MAX_ALT_TEXT_LENGTH
    ) {
      errors.push(`image.altText exceeds ${MAX_ALT_TEXT_LENGTH} characters`);
    }
  }

  return errors;
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
