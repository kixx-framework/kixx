# Static Files

Static files (CSS, JavaScript, images, fonts, etc.) are served automatically from the `public/` directory when using the `HyperviewRequestHandler`.

## How It Works

For every request, `HyperviewRequestHandler` checks for a static file matching the URL path before attempting to render a page. If a static file is found, it is served directly. If not, page rendering proceeds.

## Directory Structure

```
public/
├── favicon.ico
├── css/
│   └── styles.css
├── js/
│   └── app.js
├── images/
│   ├── logo.svg
│   └── hero.jpg
└── fonts/
    └── custom.woff2
```

## URL Mapping

| URL Path | Served From |
|---|---|
| `/favicon.ico` | `public/favicon.ico` |
| `/css/styles.css` | `public/css/styles.css` |
| `/images/logo.svg` | `public/images/logo.svg` |
| `/js/app.js` | `public/js/app.js` |

## Index File Normalization

When a URL path ends with `/`, the server appends `index.html` and checks for a static file at that path before falling back to page rendering. This allows serving index files from directory paths:

| URL Path | Checks Static File |
|---|---|
| `/` | `public/index.html` |
| `/docs/` | `public/docs/index.html` |

The index filename defaults to `index.html` and is configurable via `indexFileName`.

## Configuration

Static file behavior is configured under `hyperview.staticFiles` in `kixx-config.jsonc`:

```jsonc
{
    "environments": {
        "development": {
            "hyperview": {
                "staticFiles": {
                    "cacheControl": "no-cache",
                    "useEtag": false,
                    "indexFileName": "index.html"
                }
            }
        },
        "production": {
            "hyperview": {
                "staticFiles": {
                    "cacheControl": "public, max-age=3600",
                    "useEtag": true
                }
            }
        }
    }
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `cacheControl` | string | `"no-cache"` | `Cache-Control` header value for all static file responses |
| `useEtag` | boolean | `false` | Generate MD5 ETags for conditional request support |
| `indexFileName` | string | `"index.html"` | Filename appended to directory paths |

You can also set these per-route in the handler options:

```javascript
handlers: [
    ['HyperviewRequestHandler', {
        cacheControl: 'public, max-age=86400',
        useEtag: true,
        indexFileName: 'index.html',
    }],
],
```

## Response Headers

Every static file response includes:

| Header | Description |
|---|---|
| `Content-Type` | Determined from file extension (e.g., `text/css`, `image/svg+xml`) |
| `Last-Modified` | File modification date (always set) |
| `Cache-Control` | Configured value (default: `no-cache`) |
| `ETag` | MD5 hash of file contents (only when `useEtag: true`) |
| `Content-Length` | File size in bytes |

## Conditional Requests

When `useEtag` is enabled, the server handles conditional requests efficiently:

- `If-None-Match` header → Returns `304 Not Modified` when ETag matches
- `If-Modified-Since` header → Returns `304 Not Modified` when file has not changed

This reduces bandwidth for repeat visitors and enables effective browser caching.

## Security

The static file server prevents path traversal attacks. Requests with `..` in the path, double slashes `//`, or characters outside `[a-z0-9_.-]` (case-insensitive) are rejected with a `400 Bad Request` error. Files outside the `public/` directory cannot be served.

## Setting Up the Static File Store

The `StaticFileServerStore` is created inside the Hyperview plugin:

```javascript
// plugins/hyperview/plugin.js
import StaticFileServerStore from '../../kixx/hyperview/local/static-file-server-store.js';
import * as fileSystem from '../../kixx/node-filesystem/mod.js';

export function register(applicationContext) {
    const { applicationDirectory } = applicationContext.config;

    const staticFileServerStore = new StaticFileServerStore({
        publicDirectory: path.join(applicationDirectory, 'public'),
        fileSystem,
    });

    // ... pass to HyperviewService
}
```

See [Getting Started](getting-started.md) for the complete plugin setup.

## HEAD Requests

`HEAD` requests are handled correctly — response headers are sent but no body is written. This is useful for clients that want to check file metadata (size, modification date) without downloading the content.
