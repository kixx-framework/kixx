# Node Plugin Request Config Migration Plan

## Implementation Approach

Move the Node runtime storage plugins to the same configuration shape as the Cloudflare plugins: plugin registration should only create and register service instances from application-scope dependencies such as `logger`, while storage locations are resolved from `context.config` inside service methods. The Node adapters still need to preserve their runtime-specific ownership models: SQLite adapters should lazily open and cache connections from the request config, and filesystem adapters should resolve the configured root directory for each operation. Existing constructor injection paths (`database`, explicit `path`, explicit `directory`) should remain available for focused tests and low-level use, but normal plugin registration should no longer require `ApplicationContext.config`. Documentation and tests need to be updated because several Node interfaces and class comments currently say the Node adapters ignore `context`.

- [x] **Make DocumentStoreEngine resolve config per operation**
  - **Story**: Node document storage reads its database settings from the request or execution context instead of ApplicationContext plugin registration.
  - **What**: Update the Node `DocumentStoreEngine` so plugin-created instances can be constructed with `{ logger }` only. Change public methods and `prepareDatabase()` to pass the supplied `context` into `#getDatabase(context)`, and have `#getDatabase()` resolve `{ path, sqliteOptions }` from `context.config.env.DOCUMENT_STORE`, using `context.config.resolveFilepath(path)` before opening `DatabaseSync`. Preserve existing explicit `database`, `path`, `sqliteOptions`, and `ownsDatabase` constructor paths for tests and direct low-level use. Cache an owned SQLite connection by resolved path/options, and if a later context resolves to a different database spec, close the previous owned connection, reset prepared state for the new database, and prepare again on demand. Update JSDoc that currently says the Node engine ignores context.
  - **Where**: `src/plugins/node-document-store-engine/lib/document-store-engine.js`
  - **Documentation**: `src/kixx/document-store/document-store-engine-interface.js`, `src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js`, `src/plugins/node-config/lib/config.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: A logger-only engine resolves `DOCUMENT_STORE.path` from `context.config.env` on first database use; missing `DOCUMENT_STORE.path` throws an `AssertionError` naming the required config; `resolveFilepath()` receives the configured POSIX path; existing tests that inject a database or explicit path still work; a changed resolved path does not reuse a prepared connection for the previous database.
  - **Depends on**: none

- [x] **Register DocumentStoreEngine without config**
  - **Story**: Node plugin registration no longer depends on `ApplicationContext.config`.
  - **What**: Simplify the plugin to read only `logger` from the application context and register `new DocumentStoreEngine({ logger })`. Remove path lookup, `assertNonEmptyString`, `resolveFilepath()`, and startup log messages that depend on config.
  - **Where**: `src/plugins/node-document-store-engine/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-document-store-engine/plugin.js`, `src/plugins/node-document-store-engine/lib/document-store-engine.js`
  - **Acceptance criteria**: `register(context)` succeeds when `context` has `logger` and `registerService()` but no `config`, and registers service name `DocumentStoreEngine`.
  - **Depends on**: Make DocumentStoreEngine resolve config per operation

- [x] **Make KeyValueStore resolve config per operation**
  - **Story**: Node key/value storage reads its SQLite settings from the request or execution context instead of ApplicationContext plugin registration.
  - **What**: Update the Node `KeyValueStore` so plugin-created instances can be constructed with `{ logger }` only. Change `get()`, `put()`, and `delete()` to pass `context` into `#getDatabase(context)`, and have the database helper resolve `{ path, sqliteOptions }` from `context.config.env.KEY_VALUE_STORE`, using `context.config.resolveFilepath(path)` before opening `DatabaseSync`. Preserve explicit constructor `database` and `path` support for low-level tests. Cache and invalidate owned connections by resolved database spec, resetting prepared state when a config change causes a new database to open. Update comments and JSDoc that currently say the adapter ignores `context`.
  - **Where**: `src/plugins/node-key-value-store/lib/key-value-store.js`
  - **Documentation**: `src/kixx/key-value-store/key-value-store-interface.js`, `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`, `src/plugins/node-config/lib/config.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: A logger-only store resolves `KEY_VALUE_STORE.path` from `context.config.env` on first operation; missing `KEY_VALUE_STORE.path` throws an `AssertionError` naming the required config; `resolveFilepath()` receives the configured POSIX path; existing injected database/path tests keep working; a changed resolved path does not reuse statements or prepared state from the old database.
  - **Depends on**: none

- [x] **Register KeyValueStore without config**
  - **Story**: Node plugin registration no longer depends on `ApplicationContext.config`.
  - **What**: Simplify the plugin to read only `logger` from the application context and register `new KeyValueStore({ logger })`. Remove config lookup, `assertNonEmptyString`, path resolution, and startup config logging.
  - **Where**: `src/plugins/node-key-value-store/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-key-value-store/plugin.js`, `src/plugins/node-key-value-store/lib/key-value-store.js`
  - **Acceptance criteria**: `register(context)` succeeds when `context` has no `config`, and registers service name `KeyValueStore`.
  - **Depends on**: Make KeyValueStore resolve config per operation

- [x] **Make PageDataStore resolve config per method**
  - **Story**: Node page data reads its filesystem root from the request or execution context instead of ApplicationContext plugin registration.
  - **What**: Update the Node `PageDataStore` so plugin-created instances can be constructed with `{ logger }` only. Keep optional explicit `directory` support for tests, but when no directory was supplied, resolve `context.config.env.PAGE_DATA_STORE.directory` through `context.config.resolveFilepath(directory)` inside every read and write path. Thread the resolved root into path/key helpers instead of relying only on `this.#directory`. Update comments and JSDoc that currently say the adapter ignores `context`.
  - **Where**: `src/plugins/node-hyperview-page-data-store/lib/page-data-store.js`
  - **Documentation**: `src/kixx/hyperview/page-data-store-interface.js`, `src/plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js`, `src/plugins/node-config/lib/config.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: A logger-only store resolves `PAGE_DATA_STORE.directory` from `context.config.env` on each operation; missing directory config throws an `AssertionError` naming `PAGE_DATA_STORE.directory`; existing direct-directory tests can continue to use constructor-supplied directories; read and write namespace/path traversal behavior remains unchanged.
  - **Depends on**: none

- [x] **Register PageDataStore without config**
  - **Story**: Node plugin registration no longer depends on `ApplicationContext.config`.
  - **What**: Simplify the plugin to read only `logger` from the application context and register `new PageDataStore({ logger })`. Remove config lookup, `assertNonEmptyString`, directory resolution, and startup config logging.
  - **Where**: `src/plugins/node-hyperview-page-data-store/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-hyperview-page-data-store/plugin.js`, `src/plugins/node-hyperview-page-data-store/lib/page-data-store.js`
  - **Acceptance criteria**: `register(context)` succeeds when `context` has no `config`, and registers service name `HyperviewPageDataStore`.
  - **Depends on**: Make PageDataStore resolve config per method

- [x] **Make TemplateFileStore resolve config per method**
  - **Story**: Node template storage reads its filesystem root from the request or execution context instead of ApplicationContext plugin registration.
  - **What**: Update the Node `TemplateFileStore` so plugin-created instances can be constructed with `{ logger }` only. Keep optional explicit `directory` support for tests, but when no directory was supplied, resolve `context.config.env.TEMPLATE_FILE_STORE.directory` through `context.config.resolveFilepath(directory)` inside base/page/partial read and write methods. Thread the resolved root into file helpers and recursive partial loading instead of relying only on `this.#directory`. Update comments and JSDoc that currently say the adapter ignores `context`.
  - **Where**: `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`
  - **Documentation**: `src/kixx/hyperview/template-file-store-interface.js`, `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`, `src/plugins/node-config/lib/config.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: A logger-only store resolves `TEMPLATE_FILE_STORE.directory` from `context.config.env` on each operation; missing directory config throws an `AssertionError` naming `TEMPLATE_FILE_STORE.directory`; existing direct-directory tests can continue to use constructor-supplied directories; base/page/partial prefixes, namespace handling, and traversal protection remain unchanged.
  - **Depends on**: none

- [x] **Register TemplateFileStore without config**
  - **Story**: Node plugin registration no longer depends on `ApplicationContext.config`.
  - **What**: Simplify the plugin to read only `logger` from the application context and register `new TemplateFileStore({ logger })`. Remove config lookup, `assertNonEmptyString`, directory resolution, and startup config logging.
  - **Where**: `src/plugins/node-hyperview-template-file-store/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-hyperview-template-file-store/plugin.js`, `src/plugins/node-hyperview-template-file-store/lib/template-file-store.js`
  - **Acceptance criteria**: `register(context)` succeeds when `context` has no `config`, and registers service name `HyperviewTemplateFileStore`.
  - **Depends on**: Make TemplateFileStore resolve config per method

- [x] **Make StaticFileStore resolve config per read**
  - **Story**: Node static file serving reads its public root from the request context instead of ApplicationContext plugin registration.
  - **What**: Update the Node `StaticFileStore` so plugin-created instances can be constructed with `{ logger }` only. Keep optional explicit `directory` support for tests, but when no directory was supplied, resolve `context.config.env.STATIC_FILE_STORE.directory` through `context.config.resolveFilepath(directory)` inside `read()`. Resolve and guard paths against the per-read root directory, and cache `ManifestStore` instances by resolved root directory so manifest lookup remains efficient while allowing request config to select the root. Update class and method comments that currently describe a constructor-owned root only.
  - **Where**: `src/plugins/node-static-file-server/lib/static-file-server-store.js`
  - **Documentation**: `src/kixx/static-file-server/README.md`, `src/kixx/static-file-server/static-file-server-store-interface.js`, `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js`, `src/plugins/node-static-file-server/lib/manifest.js`, `src/plugins/node-config/lib/config.js`, `src/docs/code-style-guide.md`, `src/docs/code-quality.md`, `src/docs/code-documentation-guide.md`
  - **Acceptance criteria**: A logger-only store resolves `STATIC_FILE_STORE.directory` from `context.config.env` on each `read()`; missing directory config throws an `AssertionError` naming `STATIC_FILE_STORE.directory`; existing direct-directory tests can continue to use constructor-supplied directories; manifest lookup, ETag behavior, content type fallback, namespace handling, and path traversal protection remain unchanged.
  - **Depends on**: none

- [x] **Register StaticFileStore without config**
  - **Story**: Node plugin registration no longer depends on `ApplicationContext.config`.
  - **What**: Simplify the plugin to read only `logger` from the application context and register `new StaticFileStore({ logger })`. Remove config lookup, `assertNonEmptyString`, directory resolution, and startup config logging.
  - **Where**: `src/plugins/node-static-file-server/plugin.js`
  - **Documentation**: `src/plugins/cloudflare-static-file-server/plugin.js`, `src/plugins/node-static-file-server/lib/static-file-server-store.js`
  - **Acceptance criteria**: `register(context)` succeeds when `context` has no `config`, and registers service name `StaticFileStore`.
  - **Depends on**: Make StaticFileStore resolve config per read

- [x] **Update storage interface documentation**
  - **Story**: Public contracts describe how Node adapters now use request config.
  - **What**: Update interface and guide comments that currently say Node adapters ignore the `context` argument. Document that Node adapters resolve file/database locations from `context.config.env.*` and `context.config.resolveFilepath()` unless an explicit constructor override was supplied, while Cloudflare adapters resolve runtime bindings from `context.env`.
  - **Where**: `src/kixx/document-store/document-store-engine-interface.js`, `src/kixx/key-value-store/key-value-store-interface.js`, `src/kixx/hyperview/page-data-store-interface.js`, `src/kixx/hyperview/template-file-store-interface.js`, `src/kixx/static-file-server/static-file-server-store-interface.js`
  - **Documentation**: `src/docs/code-documentation-guide.md`, `src/app/collections/README.md`, `src/kixx/static-file-server/README.md`
  - **Acceptance criteria**: Documentation no longer claims the Node adapters ignore context, and accurately distinguishes request config from runtime bindings.
  - **Depends on**: Make DocumentStoreEngine resolve config per operation, Make KeyValueStore resolve config per operation, Make PageDataStore resolve config per method, Make TemplateFileStore resolve config per method, Make StaticFileStore resolve config per read

- [x] **Update existing Node plugin unit tests**
  - **Story**: Existing plugin tests verify registration without ApplicationContext config.
  - **What**: Update existing plugin tests for key/value, page data, and template file stores so their fake application context contains `logger` and `registerService()` only. Remove assertions that `config.resolveFilepath()` was called during registration. Assert the registered service can perform an operation when later passed a request context carrying the relevant `context.config`.
  - **Where**: `test/plugins/node-key-value-store/plugin.test.js`, `test/plugins/node-hyperview-page-data-store/plugin.test.js`, `test/plugins/node-hyperview-template-file-store/plugin.test.js`
  - **Documentation**: `src/docs/unit-testing-guide.md`, `src/plugins/cloudflare-key-value-store/plugin.js`, `src/plugins/cloudflare-hyperview-page-data-store/plugin.js`, `src/plugins/cloudflare-hyperview-template-file-store/plugin.js`
  - **Acceptance criteria**: Plugin tests fail if registration reads `context.config`, and pass when config is only supplied to service methods through request context.
  - **Depends on**: Register KeyValueStore without config, Register PageDataStore without config, Register TemplateFileStore without config

- [x] **Add missing Node plugin unit tests**
  - **Story**: All migrated Node plugins have coverage for config-free registration.
  - **What**: Add focused plugin tests for the document store engine and static file server plugins, matching the pattern used by existing Node plugin tests. Assert that registration succeeds with no `context.config`, registers the expected service names, and that the registered service resolves its config later from a request context when exercised.
  - **Where**: `test/plugins/node-document-store-engine/plugin.test.js`, `test/plugins/node-static-file-server/plugin.test.js`
  - **Documentation**: `src/docs/unit-testing-guide.md`, `src/plugins/cloudflare-document-store-engine/plugin.js`, `src/plugins/cloudflare-static-file-server/plugin.js`
  - **Acceptance criteria**: The two plugins are covered for config-free registration and later request-config-backed operation.
  - **Depends on**: Register DocumentStoreEngine without config, Register StaticFileStore without config

- [x] **Update Node adapter unit tests for request config**
  - **Story**: Adapter tests cover the new request-config resolution behavior without losing existing direct-constructor coverage.
  - **What**: Update existing Node adapter tests to add logger-only construction cases and request contexts containing `config.env.*` plus `resolveFilepath()`. Keep explicit path/directory constructor tests where they provide useful low-level coverage, but change comments and assertions that say the Node adapters ignore context. Add missing request-config coverage for document/static adapters where test coverage does not already exist in `test/plugins/`.
  - **Where**: `test/plugins/node-key-value-store/lib/key-value-store.test.js`, `test/plugins/node-hyperview-page-data-store/lib/page-data-store.test.js`, `test/plugins/node-hyperview-template-file-store/lib/template-file-store.test.js`, `test/plugins/node-document-store-engine/lib/document-store-engine.test.js`, `test/plugins/node-static-file-server/lib/static-file-server-store.test.js`
  - **Documentation**: `src/docs/unit-testing-guide.md`, `src/plugins/cloudflare-document-store-engine/lib/document-store-engine.js`, `src/plugins/cloudflare-key-value-store/lib/key-value-store.js`, `src/plugins/cloudflare-hyperview-page-data-store/lib/page-data-store.js`, `src/plugins/cloudflare-hyperview-template-file-store/lib/template-file-store.js`, `src/plugins/cloudflare-static-file-server/lib/static-file-server-store.js`
  - **Acceptance criteria**: Tests prove each Node adapter resolves the correct config section from method context, calls `resolveFilepath()` with the configured POSIX path/directory, throws a clear assertion when required config is missing, and preserves existing storage behavior.
  - **Depends on**: Make DocumentStoreEngine resolve config per operation, Make KeyValueStore resolve config per operation, Make PageDataStore resolve config per method, Make TemplateFileStore resolve config per method, Make StaticFileStore resolve config per read

- [x] **Audit ApplicationContext config references**
  - **Story**: No plugin registration path depends on removed ApplicationContext config.
  - **What**: Search `src/plugins/` for `context.config` and distinguish request-time adapter usage from application-context plugin registration. Remove any remaining `context.config` usage from plugin `register()`/`initialize()` functions, and confirm remaining occurrences are inside service methods that receive `RequestContext` or execution contexts.
  - **Where**: `src/plugins/`
  - **Documentation**: `src/docs/code-quality.md`, `src/plugins/mod.js`
  - **Acceptance criteria**: `rg "context\\.config|\\{[^\\n}]*config" src/plugins -n` shows no config destructuring in Node plugin registration modules; remaining `context.config` hits are only request/execution method paths or config-reader error messages.
  - **Depends on**: Register DocumentStoreEngine without config, Register KeyValueStore without config, Register PageDataStore without config, Register TemplateFileStore without config, Register StaticFileStore without config

- [x] **Run lint and unit tests**
  - **Story**: The migration is verified across changed source and unit coverage.
  - **What**: Run the linter on changed source and test files, then run the focused plugin/adapter tests and the full non-integration test suite. Fix any reported lint or test failures.
  - **Where**: `node run-linter.js src/plugins/node-document-store-engine src/plugins/node-key-value-store src/plugins/node-hyperview-page-data-store src/plugins/node-hyperview-template-file-store src/plugins/node-static-file-server src/kixx/document-store src/kixx/key-value-store src/kixx/hyperview src/kixx/static-file-server test/plugins/node-document-store-engine test/plugins/node-key-value-store test/plugins/node-hyperview-page-data-store test/plugins/node-hyperview-template-file-store test/plugins/node-static-file-server`, `node run-tests.js test/plugins/node-document-store-engine test/plugins/node-key-value-store test/plugins/node-hyperview-page-data-store test/plugins/node-hyperview-template-file-store test/plugins/node-static-file-server`, `node run-tests.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/docs/unit-testing-guide.md`
  - **Acceptance criteria**: Lint exits 0, focused tests pass, and `node run-tests.js` passes.
  - **Depends on**: Update storage interface documentation, Update existing Node plugin unit tests, Add missing Node plugin unit tests, Update Node adapter unit tests for request config, Audit ApplicationContext config references
