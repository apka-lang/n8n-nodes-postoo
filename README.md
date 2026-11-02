# n8n-nodes-postoo

An n8n community node for publishing social-media posts through [Postoo](https://postoo.pl).

The node can publish to any supported social account connected in Postoo, including LinkedIn, Facebook, Instagram, TikTok, Bluesky, Pinterest, Threads, and YouTube. Account availability depends on the connections enabled in your Postoo workspace.

## Installation

On a self-hosted n8n instance:

1. Open **Settings → Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-postoo`.
4. Confirm the installation and restart n8n if prompted.

## Credentials

1. In Postoo, open **Settings → API Keys** and create an API key.
2. In n8n, create a **Postoo API** credential.
3. Paste the API key.
4. Keep the default base URL, `https://postoo.pl/api/v1`, unless you use a preview or self-hosted Postoo instance.
5. Select **Save**. n8n tests the credential against `GET /accounts`.

n8n stores credential values encrypted. Treat the API key as a secret and revoke it in Postoo if it is exposed.

## Operations

### Post → Publish

Publishes one post to one connected social account using `POST /publish`.

- **Social Account Name or ID**: Choose a connected account or provide its Postoo account ID with an expression.
- **Content**: Plain-text post content, up to 5,000 characters.
- **Media URL**: Optional public image or video URL.
- **Idempotency Key**: Optional 8 to 128 character key. Reusing the same key makes retries safe and avoids duplicate posts.

The operation returns the external post ID, platform, and publication status.

### Account → List

Lists the social accounts connected to the Postoo workspace using `GET /accounts`. This is useful for dynamic fan-out workflows and for resolving account IDs before publishing.

## Example workflow

```text
[Trigger] → [Prepare content]
          → [Postoo: Publish to LinkedIn]
          → [Postoo: Publish to Facebook]
          → [Postoo: Publish to Instagram]
          → [Postoo: Publish to TikTok]
```

For retries, use a stable idempotency key derived from your source record and target account, such as `post-{{$json.id}}-{{$json.accountId}}`.

## Errors and rate limits

Postoo errors are returned in English with a stable code and request ID where available. Common codes include:

- `invalid_api_key`
- `rate_limit_exceeded`
- `account_not_found`
- `account_inactive`
- `account_disconnected`
- `publish_rejected`
- `publish_failed_unknown`

Default API limits:

- Publish requests: 60 per hour for each API key.
- Account and post reads: 120 per minute for each API key.

## Development

```bash
npm ci
npm run lint
npm test
npx @n8n/scan-community-package n8n-nodes-postoo
```

Releases are published from GitHub Actions with npm provenance. Local `npm publish` is intentionally not part of the release process.

## License

[MIT](LICENSE)
