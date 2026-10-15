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

Only the config above and the e2e test harness (`package.json`, `package-lock.json`, `run-tests.js`, and `test/`) are tracked by git. Secrets, copied code, and `node_modules/` are ignored. The build keeps the config, secrets, harness, and `node_modules/` across rebuilds.

Release testing
---------------

Before a Kixx release:

1. Build: `node tools/build-test-app.js` from the repo root.
2. Deploy this directory to the Cloudflare test Worker and the Node.js test server.
3. Install test dependencies: `npm install` in this directory (first time, or after `package.json` changes).
4. Run the e2e suite from this directory: `node run-tests.js --cloudflare` and `node run-tests.js --nodejs`. Use `node run-tests.js --development` against a local `node node-server.js`.

See [test/README.md](test/README.md) for credentials, targets, and options.
