# `kixx admin` — Administration

Commands for creating the first admin account, minting Publishing API tokens,
and running data migrations against a deployment's Admin API. See
[configuration.md](configuration.md) for `--environment` (`-e`) and
`--origin`, which every sub-command except `gen-secure-token` takes.

## Credentials

Admin credentials are never written to a file or passed as arguments. Commands
prompt for them, with password entry hidden. Set these environment variables
to skip a prompt in scripts:

- `KIXX_ADMIN_EMAIL`
- `KIXX_ADMIN_PASSWORD`
- `KIXX_ADMIN_INVITE_TOKEN`

When a value is needed, its variable is unset, and stdin is not a terminal,
the command fails naming the variable instead of waiting.

Every command resolves the environment and origin before prompting, so a bad
`-e` fails without asking for secrets.

## Bootstrap the first admin

1. Generate a token:

   ```sh
   kixx admin gen-secure-token
   ```

2. Set it as the `ADMIN_BOOTSTRAP_TOKEN` secret on the deployment.
3. Redeem it to create the root admin:

   ```sh
   kixx admin accept-invite -e production
   ```

4. Mint a publishing token and store it in `.kixx/secrets.json`:

   ```sh
   kixx admin create-publishing-token -e production
   ```

5. Remove `ADMIN_BOOTSTRAP_TOKEN` from the deployment.

The bootstrap token is single-use even while it stays configured. Removing it
is still good practice. `ADMIN_BOOTSTRAP_TOKEN` should be marked `# @optional`
in `example.env.secrets` so Worker builds keep working after it is removed
(see [configuration.md](configuration.md#exampleenvsecrets)).

## `gen-secure-token`

Prints a 256-bit token as lowercase hexadecimal text.

```sh
kixx admin gen-secure-token [--prefix <text>]
```

| Option | Description |
| --- | --- |
| `--prefix` | Literal prefix prepended to the token |

## `accept-invite`

Redeems a one-time admin invite or bootstrap token and creates the admin
account it grants.

```sh
kixx admin accept-invite -e <env> [--origin <url>]
```

Prompts for the invite token, the new account's email address, and its
password (twice). The password must be 12 to 256 characters, checked locally
before any request.

On success, prints the account's id, email address, and creation date. Errors:

| Server code | Message meaning |
| --- | --- |
| `InvalidInvite` | The token is unknown, expired, revoked, or already used. |
| `NewUserConflictError` | An admin with that email exists. The invite was not used; retry with another email. |
| `InviteSpentInEmailRace` | A concurrent signup took the email and consumed the invite. A new invite is required. |

## `create-publishing-token`

Mints a Publishing API bearer token, authenticating as an existing admin.

```sh
kixx admin create-publishing-token -e <env> \
  [--roles editor] [--ttl 2592000] [--description <text>] [--origin <url>]
```

| Option | Description |
| --- | --- |
| `--roles` | Publishing role id; repeat for several. Defaults to `editor` |
| `--ttl` | Time to live in seconds, a positive whole number; defaults to 2592000 (30 days) |
| `--description` | Operator-facing description |

The token is printed once, in a labeled block naming
`app.environments.<env>.publishingToken` in `.kixx/secrets.json`. The command
writes it nowhere; copy it in by hand.

## `list-migrations`

Lists every registered migration in registry order, with its status and, for
a failed migration, its error.

```sh
kixx admin list-migrations -e <env> [--origin <url>]
```

## `run-migration`

Runs **one** bounded batch of a migration. Repeat the command until it prints
`done: true`. When not done, it prints the next command to run on a `Next:`
line.

```sh
kixx admin run-migration -e <env> <id> [--dry-run] [--cursor <cursor>] [--force] [--origin <url>]
```

| Option | Description |
| --- | --- |
| `--dry-run` | Preview one batch without changing anything |
| `--cursor` | Dry-run cursor from a prior batch; only with `--dry-run` |
| `--force` | Restart an applied or failed real run from the beginning |

To apply a migration:

1. Run `list-migrations` and pick a `pending` (or intended `failed`) migration.
2. Dry-run batches until `done: true`, passing each returned `--cursor`.
3. Review the dry-run stats.
4. Run real batches, without `--cursor` (the server owns real-run progress),
   until `done: true`.
5. Run `list-migrations` and confirm `status: applied`.

Before a real batch the command prints `Running on <env> (<origin>)`.

`--force` runs immediately, with no confirmation prompt. It resets the run's
cursor, stats, batch count, and timestamps, which the server cannot
reconstruct. Use it only to rerun an applied migration or to restart one with
an invalid cursor. `--dry-run` with `--force` is a usage error.

| Conflict | Meaning | Next action |
| --- | --- | --- |
| Already applied | Real run of an applied migration without `--force` | Pass `--force` to rerun it deliberately |
| Cursor conflict | The stored cursor is invalid; the run is now failed | Restart it with `--force` |
| Concurrency conflict | Another operator advanced the migration first | Run `list-migrations` and retry **without** `--force` |
