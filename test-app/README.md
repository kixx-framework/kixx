Test App
========

This is a deployable test application for the Kixx Framework.

Code is copied from ../lib/ to this directory and then deployed to a test Worker on Cloudflare and a separate Node.js test server. This allows us to run end-to-end tests against real deployment target environments.

Building
--------

From the repo root:

```
node tools/build-test-app.js
```

It validates this directory's config against lib/, then replaces the copied code with a fresh copy of lib/ and writes hydrated `node-config.jsonc` and `cloudflare-config.jsonc`. If validation fails, it lists every problem and writes nothing.

These must exist first:

- `.env.development`, `.env.production`, and their `.secrets` files
- `node-config-test-context.json` and `cloudflare-config-test-context.json` (start from lib's `*-test-context.json`)
- `.kixx/config.json` and `.kixx/secrets.json` (start from `lib/.kixx/example.*.json`)

Only the config above is tracked by git. Secrets and copied code are ignored.
