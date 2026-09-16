const LINKEDIN_API_VERSION = "202608";
const LINKEDIN_REQUEST_TIMEOUT_MS = 20000;
const LINKEDIN_UPLOAD_TIMEOUT_MS = 30000;
const IMAGE_STATUS_POLL_MS = 1000;
const IMAGE_STATUS_MAX_POLLS = 12;

function apiHeaders(accessToken, contentType = false) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0"
  };

  if (contentType) headers["Content-Type"] = "application/json";
  return headers;
}

async function publishPost({ accessToken, authorUrn, text, content }) {
  const payload = {
    author: authorUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false
  };

  if (content) payload.content = content;

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: apiHeaders(accessToken, true),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS)
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`LinkedIn post ${response.status}: ${body}`);
  }

  return {
    postId: response.headers.get("x-restli-id") || null,
    body: body || null
  };
}

async function initializeImageUpload({ accessToken, ownerUrn }) {
  const response = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: apiHeaders(accessToken, true),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: ownerUrn
        }
      }),
      signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => null);

  if (
    !response.ok ||
    !payload?.value?.uploadUrl ||
    !payload?.value?.image
  ) {
    throw new Error(
      `LinkedIn image initialization failed (${response.status})`
    );
  }

  return {
    uploadUrl: payload.value.uploadUrl,
    imageUrn: payload.value.image
  };
}

async function uploadImage({ accessToken, uploadUrl, imageBuffer, contentType }) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(LINKEDIN_UPLOAD_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LinkedIn image upload ${response.status}: ${body}`);
  }
}

async function getImageStatus({ accessToken, imageUrn }) {
  const encodedUrn = encodeURIComponent(imageUrn);
  const response = await fetch(
    `https://api.linkedin.com/rest/images/${encodedUrn}`,
    {
      headers: apiHeaders(accessToken),
      signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.status) {
    throw new Error(`LinkedIn image status failed (${response.status})`);
  }

  return payload.status;
}

async function waitForImageAvailable({ accessToken, imageUrn }) {
  for (let attempt = 0; attempt < IMAGE_STATUS_MAX_POLLS; attempt += 1) {
    const status = await getImageStatus({ accessToken, imageUrn });

    if (status === "AVAILABLE") return;
    if (status === "PROCESSING_FAILED") {
      throw new Error("LinkedIn image processing failed");
    }

    await new Promise((resolve) => setTimeout(resolve, IMAGE_STATUS_POLL_MS));
  }

  throw new Error("LinkedIn image processing timed out");
}

async function publishTextPost({ accessToken, authorUrn, text }) {
  return publishPost({ accessToken, authorUrn, text });
}

async function publishImagePost({
  accessToken,
  authorUrn,
  text,
  imageBuffer,
  contentType,
  altText
}) {
  const { uploadUrl, imageUrn } = await initializeImageUpload({
    accessToken,
    ownerUrn: authorUrn
  });

  await uploadImage({
    accessToken,
    uploadUrl,
    imageBuffer,
    contentType
  });

  await waitForImageAvailable({ accessToken, imageUrn });

  const result = await publishPost({
    accessToken,
    authorUrn,
    text,
    content: {
      media: {
        id: imageUrn,
        ...(altText ? { altText } : {})
      }
    }
  });

  return {
    ...result,
    imageUrn
  };
}

module.exports = { publishTextPost, publishImagePost };
