import fs from "node:fs";
import path from "node:path";
import { assertValidLinkedInRequest } from "./lib/linkedin-request.mjs";

const requestPath = process.argv[2];
const mode = process.env.MODE || "push";
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const bridgeKey = process.env.SOCIAL_BRIDGE_KEY;
const bridgeUrl = process.env.SOCIAL_BRIDGE_URL;
const branch = process.env.GITHUB_REF_NAME || "main";
const sourceSha = process.env.GITHUB_SHA || null;

if (!requestPath) throw new Error("Usage: node scripts/publish-linkedin.mjs <request.json>");
if (!["push", "schedule"].includes(mode)) throw new Error(`Unsupported MODE: ${mode}`);
if (!repository || !githubToken) throw new Error("GitHub repository/token environment is missing");
if (!bridgeKey || !bridgeUrl) throw new Error("Social Bridge environment is missing");

function nowIso() {
  return new Date().toISOString();
}

function encodeGitHubPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function githubContents(method, filePath, body) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/contents/${encodeGitHubPath(filePath)}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  if (response.status === 404 && method === "GET") return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(`GitHub contents ${method} ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function readReceipt(receiptPath) {
  const payload = await githubContents("GET", receiptPath);
  if (!payload) return null;

  const content = Buffer.from(payload.content || "", "base64").toString("utf8");
  return {
    sha: payload.sha,
    data: JSON.parse(content)
  };
}

async function writeReceipt(receiptPath, receipt, sha) {
  const payload = await githubContents("PUT", receiptPath, {
    message: `${sha ? "Update" : "Claim"} LinkedIn delivery ${path.basename(requestPath)}`,
    content: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`).toString("base64"),
    branch,
    ...(sha ? { sha } : {})
  });

  return payload.content.sha;
}

function shouldRun(publishAt) {
  if (mode === "schedule") {
    if (!publishAt) return false;
    return publishAt.getTime() <= Date.now();
  }

  if (publishAt && publishAt.getTime() > Date.now()) return false;
  return true;
}

async function checkLinkedInConnection() {
  const response = await fetch(`${bridgeUrl}/linkedin/status`, {
    headers: { Authorization: `Bearer ${bridgeKey}` }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || payload?.connected !== true) {
    throw new Error(`LinkedIn preflight failed (${response.status})`);
  }
}

async function publishToBridge({ text, image }) {
  const payload = { text };

  if (image) {
    payload.image = {
      data: fs.readFileSync(image.absolutePath).toString("base64"),
      contentType: image.contentType,
      ...(image.altText ? { altText: image.altText } : {})
    };
  }

  const response = await fetch(`${bridgeUrl}/linkedin/post`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bridgeKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || result?.ok !== true) {
    throw new Error(`Social Bridge publish failed (${response.status})`);
  }

  return result;
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const validated = assertValidLinkedInRequest(request, { mode });

if (!shouldRun(validated.publishAt)) {
  if (validated.publishAt) {
    console.log(`Not due yet: ${requestPath} -> ${validated.publishAt.toISOString()}`);
  } else {
    console.log(`Skipping unscheduled entry during scheduler run: ${requestPath}`);
  }
  process.exit(0);
}

const deliveryName = path.basename(requestPath, ".json");
const receiptPath = `receipts/linkedin/${deliveryName}.json`;
const existing = await readReceipt(receiptPath);

if (existing) {
  console.log(`Delivery already has durable receipt (${existing.data.state || "unknown"}): ${receiptPath}`);
  process.exit(0);
}

await checkLinkedInConnection();

const claim = {
  state: "claimed",
  request: requestPath.replaceAll("\\", "/"),
  sourceSha,
  claimedAt: nowIso(),
  ...(validated.publishAt ? { publishAt: validated.publishAt.toISOString() } : {}),
  ...(validated.image ? { image: validated.image.relativePath } : {})
};

let receiptSha;
try {
  receiptSha = await writeReceipt(receiptPath, claim);
} catch (error) {
  if (error.status === 409 || error.status === 422) {
    console.log(`Another runner claimed this delivery first: ${receiptPath}`);
    process.exit(0);
  }
  throw error;
}

try {
  console.log(`Publishing ${requestPath}`);
  const result = await publishToBridge(validated);

  const published = {
    ...claim,
    state: "published",
    publishedAt: nowIso(),
    postId: result.postId || null,
    mediaType: result.mediaType || (validated.image ? "image" : "text"),
    ...(result.imageUrn ? { imageUrn: result.imageUrn } : {})
  };

  await writeReceipt(receiptPath, published, receiptSha);
  console.log(`Published successfully. postId=${result.postId || "unknown"}`);
} catch (error) {
  const attention = {
    ...claim,
    state: "attention_required",
    failedAt: nowIso(),
    reason: error.message
  };

  try {
    await writeReceipt(receiptPath, attention, receiptSha);
  } catch (receiptError) {
    console.error(`Could not update receipt after publish failure: ${receiptError.message}`);
  }

  throw error;
}
