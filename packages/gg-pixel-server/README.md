# @kenkaiiii/gg-pixel-server

Cloudflare Workers backend for gg-pixel ingestion and management APIs.

This package is private and is not published as an SDK. Local tests use the in-repo D1/schema fixtures and do not require Cloudflare credentials.

## Local verification

```sh
pnpm --dir packages/gg-pixel-server run check
pnpm --dir packages/gg-pixel-server run test
```

Credentialed commands such as `wrangler deploy` and remote D1 migrations are intentionally not part of local verification.
