# Changelog

All notable changes to this package are documented here.

## [0.1.2] - 2026-11-08

### Changed

- Explain that idempotency keys currently provide correlation and forward compatibility, not guaranteed replay or deduplication.
- Require **On Error** to preserve per-item output before publishing multiple input items, so a later failure cannot hide an earlier successful post.

### Fixed

- Block publishes that n8n could repeat automatically through **Retry On Fail** or AI Agent tool execution.
- Report unstructured failures, unrecognized error codes, and malformed success responses at the publish request boundary as unknown outcomes, with guidance to inspect the destination before any manual retry.

## 0.1.0

- Initial release.
- Publish text and optional media to a connected Postoo social account.
- List connected Postoo social accounts.
- Accept optional idempotency keys for correlation and forward compatibility.
