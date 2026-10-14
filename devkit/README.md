Kixx Devkit
===========

The `kixx` command: build and deployment tools for Kixx applications. It
creates the first admin account, mints publishing tokens, runs data
migrations, publishes application content, and builds and deploys Cloudflare
Worker versions.

Install
-------

With Node.js 24 or later:

```
npm install -g kixx-devkit
```

Or with Deno 2.8 or later:

```
deno install -g -RWNE --allow-sys=homedir jsr:@kixx/devkit/kixx
```

The Deno permissions:

- `-R` read and `-W` write: project files, `.kixx` settings, Cloudflare state
  files, and the generated `cloudflare-config.generated.js`.
- `-N` net: the Cloudflare API and your application's Admin and Publishing
  APIs.
- `-E` env: the `KIXX_ADMIN_*` prompt variables.
- `--allow-sys=homedir`: find the `~/.kixx` settings layer.

No subprocess (`--allow-run`) or FFI access is needed. The CLI reads project
configuration as data and never executes project code.

Upgrade:

```
npm install -g kixx-devkit@latest
deno install -g -f -RWNE --allow-sys=homedir jsr:@kixx/devkit/kixx
```

Check the install with `kixx --version`. Every command has `--help`.

Commands
--------

- `kixx admin gen-secure-token` — generate a secure token.
- `kixx admin accept-invite` — redeem an invite and create an admin account.
- `kixx admin create-publishing-token` — mint a Publishing API token.
- `kixx admin list-migrations` — list migrations and their status.
- `kixx admin run-migration` — run one batch of a migration.
- `kixx app publish` — publish content and assign it to a build.
- `kixx app assign-build` — assign an existing Release to a build.
- `kixx cloudflare create-worker` — create a Worker.
- `kixx cloudflare update-worker` — replace a Worker's settings.
- `kixx cloudflare create-worker-version` — bundle and upload a Worker version.
- `kixx cloudflare deploy-version` — route all traffic to a Worker version.

Documentation:

- [configuration.md][configuration-doc]: `.kixx` settings,
  `cloudflare-config.jsonc`, `.env.<env>`, and `example.env.secrets`.
- [admin.md][admin-doc]: admin accounts, tokens, and migrations.
- [app.md][app-doc]: publishing content.
- [cloudflare.md][cloudflare-doc]: Workers, versions, deployment, and
  workflows.

`app` commands require an application serving Publishing API build assignment
protocol 2 and addressing format 4; see [app.md][app-doc-server-requirement].

Not included: creating D1, KV, or R2 resources, and managing Worker secrets.
Use the Cloudflare dashboard or Wrangler for those.

<!-- Absolute links so they resolve on npmjs.com and jsr.io. -->
[configuration-doc]: https://github.com/kixx-framework/kixx/blob/main/devkit/docs/configuration.md
[admin-doc]: https://github.com/kixx-framework/kixx/blob/main/devkit/docs/admin.md
[app-doc]: https://github.com/kixx-framework/kixx/blob/main/devkit/docs/app.md
[app-doc-server-requirement]: https://github.com/kixx-framework/kixx/blob/main/devkit/docs/app.md#server-requirement
[cloudflare-doc]: https://github.com/kixx-framework/kixx/blob/main/devkit/docs/cloudflare.md

Development
-----------

Install dev dependencies once with `npm install` in `devkit/`. From the repo
root:

```
node devkit/run-tests.js                     # full suite on Node.js
deno run -A devkit/run-tests.js              # full suite on Deno
node devkit/run-tests.js devkit/test/lib     # a subtree
node devkit/run-linter.js devkit             # lint
node devkit/kixx.js <command> <subcommand>   # run the CLI from source
```

The runners accept paths relative to the current directory. `run-tests.js`
also takes `--skip <path>` (repeatable). See
[commands/README.md][commands-readme] for adding a command and
[test/README.md][test-readme] for writing tests.

[commands-readme]: https://github.com/kixx-framework/kixx/blob/main/devkit/commands/README.md
[test-readme]: https://github.com/kixx-framework/kixx/blob/main/devkit/test/README.md

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
