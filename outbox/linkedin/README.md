# LinkedIn outbox

This directory is the publish queue used by ChatGPT through GitHub.

A new `.json` file committed to this directory on `main` triggers the `Publish LinkedIn outbox` GitHub Actions workflow.

Only newly added JSON files are published. Editing or deleting an existing file does not publish it again.

## Format

```json
{
  "publish": true,
  "text": "Post text goes here"
}
```

`publish` must be exactly `true`, and `text` must be a non-empty string.

The workflow sends only the `text` field to Social Bridge. LinkedIn credentials never enter the repository or the AI agent context; the workflow authenticates to Social Bridge using the GitHub Actions secret `SOCIAL_BRIDGE_KEY`.

Each published file remains in git history as a simple public audit trail of what the agent asked Social Bridge to publish.
