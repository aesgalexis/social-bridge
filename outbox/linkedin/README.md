# LinkedIn outbox

This directory is the publish queue used by ChatGPT through GitHub.

A new `.json` file committed here on `main` triggers the `Publish LinkedIn outbox` workflow. Entries with a future `publishAt` are left pending until the scheduled workflow sees them due.

## Immediate text post

```json
{
  "publish": true,
  "text": "Post text goes here"
}
```

## Scheduled post

Use an ISO-8601 timestamp with an explicit timezone or `Z`:

```json
{
  "publish": true,
  "publishAt": "2026-09-18T09:30:00+02:00",
  "text": "Post text goes here"
}
```

The scheduler checks every 15 minutes. GitHub Actions schedules are best-effort, so `publishAt` means "not before this time", not exact-to-the-minute delivery.

As a guardrail, `publishAt` is rejected if it is more than 30 days in the past or more than 366 days in the future.

## Post with one image

Store the image under `media/linkedin/` and reference it from the request:

```json
{
  "publish": true,
  "text": "Post text goes here",
  "image": {
    "path": "media/linkedin/example.png",
    "altText": "Short accessible description of the image"
  }
}
```

JPG, PNG, and GIF are supported. Social Bridge currently limits the transported image to 12 MiB. `altText` is optional.

Scheduling and images can be combined in the same entry.

## Validation rules

Requests are strict on purpose. Unknown keys are rejected both in the outbox entry and inside the optional `image` object. This catches typos such as `publsihAt`, `img`, or `alttext` before anything is published.

## Delivery receipts

Before calling LinkedIn, the workflow writes a durable claim under `receipts/linkedin/`. After success it updates the receipt with the LinkedIn post ID.

If a publish attempt becomes ambiguous, the receipt remains claimed or is marked `attention_required`. Automatic runs will not retry that request, avoiding accidental duplicate posts. A human should inspect LinkedIn before deciding whether to create a new request.

Each outbox entry and delivery receipt remains in git history as a public audit trail. LinkedIn credentials never enter the repository or the AI agent context; workflows authenticate to Social Bridge through the GitHub Actions secret `SOCIAL_BRIDGE_KEY`.
