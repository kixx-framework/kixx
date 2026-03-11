# Configuration

Kixx uses a JSON with Comments (JSONC) file for application configuration, with support for per-environment overrides and a separate secrets file.

## Configuration Files

| File | Purpose |
|---|---|
| `kixx-config.jsonc` | Main application configuration |
| `.secrets.jsonc` | Secrets (API keys, passwords); exclude from version control |

The secrets file is optional — if it doesn't exist, an empty object is used. The config file must exist.

## File Format

Configuration files use JSONC format, which supports:

- Single-line comments (`//`)
- Multi-line comments (`/* */`)
- Trailing commas in objects and arrays

## Structure

The configuration file has a root-level section and an optional `environments` section. Environment-specific settings are merged over the root, so you only need to specify what differs per environment.

```jsonc
{
    // Root-level settings (apply to all environments)
    "name": "my-app",
    "processName": "my-app",

    "environments": {
        "development": {
            // Settings for NODE_ENV=development
        },
        "production": {
            // Settings for NODE_ENV=production
        }
    }
}
```

## Root Properties

| Property | Type | Description |
|---|---|---|
| `name` | string | Application name (used in logs and metadata) |
| `processName` | string | Process name for OS-level identification |

## Setting Up Configuration

```javascript
import Config from './kixx/config/config.js';
import LocalJSONConfigStore from './kixx/config-stores/local-json-config-store.js';
import * as fileSystem from './kixx/node-filesystem/mod.js';

const configStore = new LocalJSONConfigStore({
    configFilepath: './kixx-config.jsonc',
    secretsFilepath: './.secrets.jsonc',
    fileSystem,
});

const config = new Config(configStore, 'development');

// Load config and secrets before using them
await configStore.loadConfig();
await configStore.loadSecrets();
```

## Reading Configuration

Use `config.getNamespace(name)` to retrieve a section of configuration:

```javascript
const serverConfig = config.getNamespace('server');
const port = serverConfig.port; // e.g., 3000

const loggerConfig = config.getNamespace('logger');
const level = loggerConfig.level; // e.g., 'debug'
```

Use `config.getSecrets(name)` to read secrets separately:

```javascript
const dbSecrets = config.getSecrets('database');
const password = dbSecrets.password;
```

Both methods return a deep copy, so mutations do not affect the internal config state.

## Config Properties

| Property/Method | Description |
|---|---|
| `config.environment` | Current environment name (e.g., `'development'`) |
| `config.name` | Application name from config |
| `config.processName` | Process name from config |
| `config.getNamespace(name)` | Returns config section as plain object |
| `config.getSecrets(name)` | Returns secrets section as plain object |

## Standard Configuration Namespaces

### `logger`

```jsonc
{
    "logger": {
        "level": "debug"   // "debug", "info", "warn", or "error"
    }
}
```

### `server`

```jsonc
{
    "server": {
        "port": 3000
    }
}
```

### `hyperview`

Controls the Hyperview rendering system. See sub-sections below.

```jsonc
{
    "hyperview": {
        "pages": { ... },
        "staticFiles": { ... },
        "errorHandler": { ... }
    }
}
```

#### `hyperview.pages`

| Option | Type | Default | Description |
|---|---|---|---|
| `useCache` | boolean | `false` | Cache compiled templates and page data |
| `baseTemplate` | string | — | Default base template filename for all pages |
| `allowJSON` | boolean | `true` | Allow JSON responses via `Accept: application/json` |
| `indexFilePattern` | string | `"index\.(html\|json)$"` | Regex pattern for index filenames to normalize |

#### `hyperview.staticFiles`

| Option | Type | Default | Description |
|---|---|---|---|
| `cacheControl` | string | `"no-cache"` | `Cache-Control` header for static file responses |
| `useEtag` | boolean | `false` | Generate ETags for conditional request support |
| `indexFileName` | string | `"index.html"` | Filename appended to directory paths |

#### `hyperview.errorHandler`

| Option | Type | Default | Description |
|---|---|---|---|
| `handleUnexpectedErrors` | boolean | `true` | Handle errors without an HTTP status code |
| `exposeErrorDetails` | boolean | `false` | Include error name, message, and stack in responses |
| `baseTemplate` | string | — | Default base template for error pages |

## Complete Example

```jsonc
{
    "name": "my-app",
    "processName": "my-app",

    "environments": {
        "development": {
            "logger": {
                "level": "debug"
            },
            "server": {
                "port": 3000
            },
            "hyperview": {
                "pages": {
                    "useCache": false,
                    "baseTemplate": "base.html"
                },
                "staticFiles": {
                    "cacheControl": "no-cache",
                    "useEtag": false
                },
                "errorHandler": {
                    "handleUnexpectedErrors": true,
                    "exposeErrorDetails": true,
                    "baseTemplate": "base.html"
                }
            }
        },
        "production": {
            "logger": {
                "level": "info"
            },
            "server": {
                "port": 8080
            },
            "hyperview": {
                "pages": {
                    "useCache": true,
                    "baseTemplate": "base.html"
                },
                "staticFiles": {
                    "cacheControl": "public, max-age=3600",
                    "useEtag": true
                },
                "errorHandler": {
                    "handleUnexpectedErrors": true,
                    "exposeErrorDetails": false,
                    "baseTemplate": "base.html"
                }
            }
        }
    }
}
```

## Secrets File

Keep secrets in a separate file — name it `.secrets.jsonc` and exclude it from version control (add to `.gitignore`):

```jsonc
// .secrets.jsonc
{
    "environments": {
        "production": {
            "database": {
                "password": "..."
            }
        }
    }
}
```

Access secrets just like regular config:

```javascript
const dbSecrets = config.getSecrets('database');
```

## Passing Application Directory to Plugins

Plugins need to know the root directory of the application to locate `pages/`, `templates/`, and `public/`. The recommended pattern is to attach it directly to the config object during setup:

```javascript
// In lib/application.js
async loadConfig(configStore) {
    const config = new Config(configStore, this.environment);
    await configStore.loadConfig();
    await configStore.loadSecrets();

    // Make the application directory available to plugins.
    config.applicationDirectory = this.applicationDirectory;

    return config;
}
```

Plugins can then read it via `applicationContext.config.applicationDirectory`:

```javascript
// In plugins/hyperview/plugin.js
export function register(applicationContext) {
    const { applicationDirectory } = applicationContext.config;

    const pageStore = new PageStore({
        directory: path.join(applicationDirectory, 'pages'),
        fileSystem,
    });
    // ...
}
```

## Reacting to Config Changes

The `Config` object emits `update:config` and `update:secrets` events when configuration is reloaded. This is useful if you want to support runtime config reloading:

```javascript
config.on('update:config', () => {
    // Config was reloaded — re-read any cached namespace values
    const serverConfig = config.getNamespace('server');
});
```
