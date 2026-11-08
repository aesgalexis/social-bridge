import fs from "node:fs";
import path from "node:path";

export const MAX_TEXT_LENGTH = 3000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_ALT_TEXT_LENGTH = 4086;
export const MAX_SCHEDULE_FUTURE_DAYS = 366;
export const MAX_SCHEDULE_PAST_DAYS = 30;

const ALLOWED_TOP_LEVEL_KEYS = new Set(["publish", "publishAt", "text", "image"]);
const ALLOWED_IMAGE_KEYS = new Set(["path", "altText"]);
const ALLOWED_SEALED_IMAGE_KEYS = new Set(["data", "contentType", "altText"]);
const SEALED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const CONTENT_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"]
]);

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveImage({ imagePath, cwd }) {
  const imageRoot = path.resolve(cwd, "media/linkedin");
  const relativePath = imagePath.replaceAll("\\", "/");
  const absolutePath = path.resolve(cwd, relativePath);

  if (!absolutePath.startsWith(`${imageRoot}${path.sep}`)) {
    return { error: "image.path must stay under media/linkedin/" };
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return { error: `image file not found: ${relativePath}` };
  }

  const realImageRoot = fs.realpathSync(imageRoot);
  const realImagePath = fs.realpathSync(absolutePath);

  if (!realImagePath.startsWith(`${realImageRoot}${path.sep}`)) {
    return { error: "image.path must not escape media/linkedin/ through a symlink" };
  }

  const extension = path.extname(realImagePath).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);

  if (!contentType) {
    return { error: "image must be JPG, PNG, or GIF" };
  }

  const size = fs.statSync(realImagePath).size;
  if (size > MAX_IMAGE_BYTES) {
    return { error: `image exceeds ${MAX_IMAGE_BYTES}-byte transport limit` };
  }

  return {
    absolutePath: realImagePath,
    relativePath,
    contentType
  };
}

export function validateLinkedInRequest(
  request,
  {
    mode = "repository",
    nowMs = Date.now(),
    cwd = process.cwd(),
    requireImageFile = true,
    sealed = false
  } = {}
) {
  const errors = [];

  if (!isObject(request)) {
    return { errors: ["entry must be a JSON object"], value: null };
  }

  for (const key of Object.keys(request)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`unknown top-level key: ${key}`);
    }
  }

  if (request.publish !== true) {
    errors.push("publish must be true");
  }

  let text = "";
  if (typeof request.text !== "string" || !request.text.trim()) {
    errors.push("text must be a non-empty string");
  } else {
    text = request.text.trim();
    if (text.length > MAX_TEXT_LENGTH) {
      errors.push(`text exceeds ${MAX_TEXT_LENGTH} characters`);
    }
  }

  let publishAt = null;
  if (request.publishAt !== undefined) {
    if (typeof request.publishAt !== "string") {
      errors.push("publishAt must be an ISO-8601 string");
    } else {
      publishAt = new Date(request.publishAt);

      if (Number.isNaN(publishAt.getTime())) {
        errors.push("publishAt is not a valid ISO-8601 date/time");
        publishAt = null;
      } else if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(request.publishAt)) {
        errors.push("publishAt must include an explicit timezone or Z");
      } else if (mode === "push") {
        const ts = publishAt.getTime();

        if (ts < nowMs - daysToMs(MAX_SCHEDULE_PAST_DAYS)) {
          errors.push(
            `publishAt is more than ${MAX_SCHEDULE_PAST_DAYS} days in the past`
          );
        }

        if (ts > nowMs + daysToMs(MAX_SCHEDULE_FUTURE_DAYS)) {
          errors.push(
            `publishAt is more than ${MAX_SCHEDULE_FUTURE_DAYS} days in the future`
          );
        }
      }
    }
  }

  let image = null;
  if (request.image !== undefined) {
    if (!isObject(request.image)) {
      errors.push("image must be an object");
    } else {
      for (const key of Object.keys(request.image)) {
        if (!(sealed ? ALLOWED_SEALED_IMAGE_KEYS : ALLOWED_IMAGE_KEYS).has(key)) {
          errors.push(`unknown image key: ${key}`);
        }
      }

      if (sealed) {
        const data = request.image.data;
        const contentType = request.image.contentType;
        if (
          typeof data !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) ||
          !data.length
        ) {
          errors.push("image.data must be canonical base64");
        } else if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) {
          errors.push("image.data exceeds transport limit");
        } else {
          const bytes = Buffer.from(data, "base64");
          if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data) {
            errors.push("image.data is invalid base64 or exceeds transport limit");
          } else {
            image = { data };
          }
        }
        if (!SEALED_CONTENT_TYPES.has(contentType)) {
          errors.push("image.contentType must be JPEG, PNG or GIF");
        }
        if (image) image.contentType = contentType;
      } else if (typeof request.image.path !== "string" || !request.image.path.trim()) {
        errors.push("image.path is required");
      } else if (requireImageFile) {
        const resolved = resolveImage({
          imagePath: request.image.path.trim(),
          cwd
        });

        if (resolved.error) {
          errors.push(resolved.error);
        } else {
          image = resolved;
        }
      } else {
        image = {
          relativePath: request.image.path.trim().replaceAll("\\", "/")
        };
      }

      const altText =
        typeof request.image.altText === "string"
          ? request.image.altText.trim()
          : "";

      if (
        request.image.altText !== undefined &&
        typeof request.image.altText !== "string"
      ) {
        errors.push("image.altText must be a string when provided");
      } else if (altText.length > MAX_ALT_TEXT_LENGTH) {
        errors.push(`image.altText exceeds ${MAX_ALT_TEXT_LENGTH} characters`);
      }

      if (image) image.altText = altText;
    }
  }

  return {
    errors,
    value: {
      text,
      publishAt,
      image
    }
  };
}

export function assertValidLinkedInRequest(request, options) {
  const result = validateLinkedInRequest(request, options);

  if (result.errors.length > 0) {
    throw new Error(result.errors.join("; "));
  }

  return result.value;
}
