const LINKEDIN_API_VERSION = "202605";

async function publishTextPost({ accessToken, authorUrn, text }) {
  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
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
    })
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`LinkedIn ${response.status}: ${body}`);
  }

  return {
    postId: response.headers.get("x-restli-id") || null,
    body: body || null
  };
}

module.exports = { publishTextPost };
