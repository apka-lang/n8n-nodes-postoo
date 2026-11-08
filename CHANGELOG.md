# Changelog

All notable changes to this package are documented here.

## 0.1.2

- Correct the idempotency guidance: the current Postoo API does not guarantee durable replay or deduplication.
- Block publish operations when n8n's **Retry On Fail** setting is enabled.
- Treat unstructured publish transport failures as unknown outcomes so they are not presented as safe to retry.

## 0.1.0

- Initial release.
- Publish text and optional media to a connected Postoo social account.
- List connected Postoo social accounts.
- Support idempotency keys for safe publish retries.
