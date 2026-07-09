# Startup Config Loading Implementation Plan

## Implementation Approach

Move stored config ownership out of the platform config reader plugins and into the runtime entry points: the server scripts import config modules once at startup, then pass plain config objects into the readers for environment selection and runtime-specific normalization. The config readers should no longer perform filesystem reads, JSON parsing, or Cloudflare KV access; they should validate the provided object, select `config.environments[environment]`, build a resolved config object with `env`, and apply only the reformatting required by that runtime. Convert the Node config from JSON to an ES module so both Node and Cloudflare follow the same “import config, resolve config, share resolved config” lifecycle. Protect both the imported source config and the resolved request config from mutation: config modules should export frozen source objects, and readers should avoid mutating those inputs while returning separate frozen resolved config objects.

- [x] **Add shared deep freeze utility**
  - **Story**: Startup-loaded config is safe to share across every request in a process or Worker isolate.
  - **What**: Add a small dependency-free utility that recursively freezes plain objects and arrays. It should preserve function properties such as Node's `resolveFilepath()` method, and it should return the same object it freezes so readers can use it as the final normalization step.
  - **Where**: `src/kixx/utils/deep-freeze.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`, `src/docs/server-error-handling.md`, `src/plugins/node-config/lib/config.js`, `src/plugins/cloudflare-config/lib/config.js`
  - **Acceptance criteria**: Nested config objects and arrays are frozen before being shared with request contexts; function values remain callable; no external dependency is introduced; the helper is usable from both Node and Cloudflare runtime code.
  - **Depends on**: none

- [x] **Convert Node config JSON to a module**
  - **Story**: Node config is imported at startup instead of read and parsed by the config reader.
  - **What**: Replace `src/node-config.json` with `src/node-config.js` exporting the same config shape as a default JavaScript object. Preserve current environment keys and values, formatting the object according to the JavaScript style guide. Export the object through the shared freeze helper so the module singleton cannot be mutated after import.
  - **Where**: `src/node-config.json`, `src/node-config.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: The Node config data is available as a frozen ES module default export; no config values are changed during conversion; references to the default Node config path can move from `src/node-config.json` to `src/node-config.js`.
  - **Depends on**: Add shared deep freeze utility

- [x] **Freeze Cloudflare config module export**
  - **Story**: Cloudflare source config is imported once and cannot be mutated accidentally.
  - **What**: Update `src/cloudflare-config.js` so its default export is wrapped with the shared freeze helper. Do not change config values or environment structure.
  - **Where**: `src/cloudflare-config.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: The Cloudflare config source object is frozen at module load; no config values are changed; the object shape remains compatible with the refactored Cloudflare config reader.
  - **Depends on**: Add shared deep freeze utility

- [x] **Refactor Node config reader to resolve provided objects**
  - **Story**: The Node config plugin selects and normalizes config but does not load stored config.
  - **What**: Change the Node config reader API to accept a config object, environment name, and the base directory needed by `resolveFilepath()`. Remove `fs.readFileSync()`, `JSON.parse()`, and filepath parsing from the reader. Build a new resolved config object instead of mutating the imported source object, set `resolvedConfig.env` to the selected environment object, omit `environments` from the resolved object, add `resolveFilepath()`, then freeze the resolved object graph.
  - **Where**: `src/plugins/node-config/lib/config.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/docs/server-error-handling.md`
  - **Acceptance criteria**: The reader performs no filesystem access; invalid config shape and missing environment still throw `OperationalError`; the source config object's `environments` property is not deleted or modified; the returned config is frozen and includes a working `resolveFilepath()` based on the provided base directory.
  - **Depends on**: Add shared deep freeze utility

- [x] **Refactor Cloudflare config reader to resolve provided objects**
  - **Story**: The Cloudflare config plugin selects and normalizes config but does not load stored config.
  - **What**: Change the Cloudflare config reader API to accept a config object and environment name. Remove KV binding lookup, `CONFIG_STORE_BINDING_NAME`, `CONFIG_STORE_KEY`, and async storage access from the reader. Build a new resolved config object instead of mutating the imported source object, set `resolvedConfig.env` to the selected environment object, omit `environments` from the resolved object, then freeze the resolved object graph.
  - **Where**: `src/plugins/cloudflare-config/lib/config.js`
  - **Documentation**: `src/docs/code-style-guide.md`, `src/docs/server-error-handling.md`, `src/cloudflare-config.js`
  - **Acceptance criteria**: The reader performs no Cloudflare KV access and no longer needs to be async; invalid config shape and missing environment still throw `OperationalError`; the source config object's `environments` property is not deleted or modified; the returned config is frozen.
  - **Depends on**: Add shared deep freeze utility

- [x] **Import and resolve Node config at server startup**
  - **Story**: The Node.js server resolves application config once when `src/node-server.js` starts.
  - **What**: Import the Node config module during server startup and pass the imported object into the refactored Node config reader before creating the HTTP server. Preserve the existing `--config`/`CONFIG_FILE` override if desired by treating it as a JavaScript module path and dynamically importing that module, with the default moving to `src/node-config.js`; otherwise explicitly remove and document the obsolete override. Store the resolved config in a module-scope `serverConfig` and pass that same object to `appContext.createRequestContext(env, request, serverConfig)` on every request.
  - **Where**: `src/node-server.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`, `src/docs/server-error-handling.md`, `src/plugins/node-config/lib/config.js`
  - **Acceptance criteria**: Config resolution happens before `nodeServer.listen()`; `handleRequest()` does not call the config reader; each request receives the same frozen resolved config; startup fails before listening if the imported config module is missing, invalid, or lacks the selected environment; any retained `--config` support expects an ES module, not JSON.
  - **Depends on**: Convert Node config JSON to a module, Refactor Node config reader to resolve provided objects

- [x] **Import and resolve Cloudflare config at isolate startup**
  - **Story**: The Cloudflare Worker resolves application config once per Worker isolate.
  - **What**: Statically import the existing `src/cloudflare-config.js` default export in `src/cloudflare-server.js`, pass it into the refactored Cloudflare config reader during module evaluation, and store the resolved config in module scope. Remove per-request `readConfig(requestEnvironment, environment)` from `fetch()` and pass the shared resolved config to `appContext.createRequestContext(requestEnvironment, request, serverConfig)`.
  - **Where**: `src/cloudflare-server.js`, `src/cloudflare-config.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`, `src/docs/server-error-handling.md`, `src/plugins/cloudflare-config/lib/config.js`
  - **Acceptance criteria**: The Worker does not read config from KV; config is resolved once during module/isolate startup; `fetch()` does not call the config reader; every request receives the same frozen resolved config while still receiving the per-request `requestEnvironment` bindings.
  - **Depends on**: Freeze Cloudflare config module export, Refactor Cloudflare config reader to resolve provided objects

- [x] **Update development-server and documentation references**
  - **Story**: Developers use the new module-backed config path without stale JSON/KV assumptions.
  - **What**: Update project documentation and devserver forwarding behavior to match the Node config module change. If `--config` is preserved, document that it points to an ES module path such as `src/node-config.js`; if it is removed, remove forwarding and references to it from `tools/devserver.js` and the README.
  - **Where**: `README.md`, `tools/devserver.js`, `tools/devserver/app-server-process.js`, any nearby comments that mention `src/node-config.json` or config reader storage.
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: No active command examples point at `src/node-config.json`; devserver behavior matches the final Node server CLI surface; comments no longer imply config readers load JSON files or Cloudflare KV config.
  - **Depends on**: Import and resolve Node config at server startup

- [x] **Verify changed source with linting**
  - **Story**: The refactor satisfies project JavaScript style rules.
  - **What**: Run the linter on changed JavaScript source files and fix any reported issues. Do not add, modify, or run unit tests as part of this work.
  - **Where**: `node run-linter.js src/node-server.js src/cloudflare-server.js src/node-config.js src/cloudflare-config.js src/plugins/node-config/lib/config.js src/plugins/cloudflare-config/lib/config.js <new-config-helper-path> tools/devserver.js tools/devserver/app-server-process.js`
  - **Documentation**: `README.md`, `src/docs/code-style-guide.md`
  - **Acceptance criteria**: Lint exits cleanly for changed JavaScript source files; no unit test files are added or modified; tests are not run.
  - **Depends on**: Import and resolve Node config at server startup, Import and resolve Cloudflare config at isolate startup, Update development-server and documentation references
