# Getting Started

This guide walks through setting up a complete Kixx application from scratch.

## Directory Structure

Create the following structure at your project root:

```
my-app/
├── kixx/                   # Kixx framework source (copy kixx/lib/ here)
├── lib/
│   └── application.js      # App setup class
├── plugins/
│   ├── mod.js              # Plugin registry
│   └── hyperview/
│       └── plugin.js       # Hyperview plugin
├── pages/                  # Page content
├── templates/
│   ├── base-templates/
│   ├── partials/
│   └── helpers/
├── public/                 # Static files
├── routes/
│   └── main.js
├── virtual-hosts.js
├── kixx-config.jsonc
├── .secrets.jsonc
└── server.js
```

Copy the Kixx `lib/` directory into your project as `kixx/`.

## Configuration File

Create `kixx-config.jsonc` at the project root:

```jsonc
{
    "name": "my-app",
    // The processName appears in system process lists and log output.
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
                    "allowJSON": true,
                    "useCache": false,
                    "baseTemplate": "base.html",
                },
                "staticFiles": {
                    "cacheControl": "no-cache",
                    "useEtag": false,
                },
                "errorHandler": {
                    "handleUnexpectedErrors": true,
                    "exposeErrorDetails": true,
                    "useCache": false,
                    "baseTemplate": "base.html",
                },
            },
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
                    "allowJSON": true,
                    "useCache": false,
                    "baseTemplate": "base.html",
                },
                "staticFiles": {
                    "cacheControl": "public, max-age=31536000",
                    "useEtag": false,
                },
                "errorHandler": {
                    "handleUnexpectedErrors": true,
                    "exposeErrorDetails": false,
                    "useCache": false,
                    "baseTemplate": "base.html",
                },
            },
        }
    }
}
```

Create `.secrets.jsonc` and **exclude it from version control**:

```jsonc
{
    // Add environment-specific secrets here — same structure as kixx-config.jsonc
}
```

## Route Definitions

Create `routes/main.js`:

```javascript
export default [
    {
        name: 'StaticPages',
        pattern: '*',
        inboundMiddleware: [],
        outboundMiddleware: [],
        errorHandlers: [
            [ 'HyperviewErrorHandler' ],
        ],
        targets: [
            {
                name: 'GetPage',
                methods: [ 'GET', 'HEAD' ],
                handlers: [
                    [ 'HyperviewRequestHandler' ],
                ],
            },
        ],
    },
];
```

Create `virtual-hosts.js`:

```javascript
import mainRoutes from './routes/main.js';

export default [{
    name: 'Main',
    pattern: 'localhost',
    routes: mainRoutes,
}];
```

## Hyperview Plugin

The Hyperview plugin registers the page rendering service and its request/error handlers. Create `plugins/hyperview/plugin.js`:

```javascript
import path from 'node:path';
import * as fileSystem from '../../kixx/node-filesystem/mod.js';
import PageStore from '../../kixx/hyperview/local/page-store.js';
import StaticFileServerStore from '../../kixx/hyperview/local/static-file-server-store.js';
import TemplateStore from '../../kixx/hyperview/local/template-store.js';
import TemplateEngine from '../../kixx/hyperview/template-engine.js';
import HyperviewService from '../../kixx/hyperview/hyperview-service.js';
import HyperviewRequestHandler from '../../kixx/hyperview/request-handler.js';
import HyperviewErrorHandler from '../../kixx/hyperview/error-handler.js';


export function register(applicationContext) {
    const { applicationDirectory } = applicationContext.config;
    const templatesDirectory = path.join(applicationDirectory, 'templates');

    applicationContext.registerService('Hyperview', new HyperviewService({
        pageStore: new PageStore({
            directory: path.join(applicationDirectory, 'pages'),
            fileSystem,
        }),
        staticFileServerStore: new StaticFileServerStore({
            publicDirectory: path.join(applicationDirectory, 'public'),
            fileSystem,
        }),
        templateStore: new TemplateStore({
            helpersDirectory: path.join(templatesDirectory, 'helpers'),
            partialsDirectory: path.join(templatesDirectory, 'partials'),
            templatesDirectory: path.join(templatesDirectory, 'base-templates'),
            fileSystem,
        }),
        templateEngine: new TemplateEngine(),
    }));

    applicationContext.registerRequestHandler('HyperviewRequestHandler', HyperviewRequestHandler);
    applicationContext.registerErrorHandler('HyperviewErrorHandler', HyperviewErrorHandler);
}

export async function initialize(applicationContext) {
    const hyperviewService = applicationContext.getService('Hyperview');
    await hyperviewService.initialize();
}
```

Create the plugin registry at `plugins/mod.js`:

```javascript
import * as hyperview from './hyperview/plugin.js';

export default new Map([
    [ 'hyperview', hyperview ],
]);
```

## Application Class

Create `lib/application.js` to organize the startup logic:

```javascript
import path from 'node:path';
import * as fileSystem from '../kixx/node-filesystem/mod.js';
import ApplicationContext from '../kixx/context/application-context.js';
import Config from '../kixx/config/config.js';
import ConfigStore from '../kixx/config-stores/local-json-config-store.js';
import DevLogger from '../kixx/logger/dev-logger.js';
import ProdLogger from '../kixx/logger/prod-logger.js';
import HttpRouter from '../kixx/http-router/http-router.js';
import JSModuleHttpRoutesStore from '../kixx/http-routes-stores/js-module-http-routes-store.js';
import NodeServer from '../kixx/node-http-server/node-server.js';
import { assertNonEmptyString } from '../kixx/assertions.js';

import plugins from '../plugins/mod.js';
import vhostsConfigs from '../virtual-hosts.js';


export default class Application {

    constructor({ environment, applicationDirectory }) {
        assertNonEmptyString(environment);

        Object.defineProperties(this, {
            environment: {
                enumerable: true,
                value: environment,
            },
            applicationDirectory: {
                enumerable: true,
                value: applicationDirectory,
            },
            runtime: {
                enumerable: true,
                value: { server: { name: 'server' } },
            },
        });
    }

    createConfigStore() {
        return new ConfigStore({
            configFilepath: path.join(this.applicationDirectory, 'kixx-config.jsonc'),
            secretsFilepath: path.join(this.applicationDirectory, '.secrets.jsonc'),
            fileSystem,
        });
    }

    async loadConfig(configStore) {
        const config = new Config(configStore, this.environment);

        await configStore.loadConfig();
        await configStore.loadSecrets();

        // Make the application directory available to plugins via config.
        config.applicationDirectory = this.applicationDirectory;

        return config;
    }

    createLogger(config) {
        const loggerConfig = config.getNamespace('logger');
        const name = loggerConfig.name ?? config.name;
        const level = loggerConfig.level ?? DevLogger.LEVELS.DEBUG;

        if (this.environment === 'production') {
            return new ProdLogger({ name, level });
        }
        return new DevLogger({ name, level });
    }

    createApplicationContext(config, logger) {
        return new ApplicationContext({ runtime: this.runtime, config, logger });
    }

    async loadPlugins(applicationContext) {
        for (const plugin of plugins.values()) {
            plugin.register(applicationContext);
            // eslint-disable-next-line no-await-in-loop
            await plugin.initialize(applicationContext);
        }
        return applicationContext;
    }

    createHttpRouter(applicationContext) {
        const { middleware, requestHandlers, errorHandlers } = applicationContext;

        return new HttpRouter({
            store: new JSModuleHttpRoutesStore(vhostsConfigs),
            middleware,
            handlers: requestHandlers,
            errorHandlers,
        });
    }

    createHttpServer(applicationContext, port) {
        const config = applicationContext.config.getNamespace('server');
        return new NodeServer({ port: port ?? config.port ?? 8080 });
    }
}
```

## Application Entry Point

Create `server.js`:

```javascript
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Application from './lib/application.js';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

const PARSE_ARGS_OPTIONS = {
    options: {
        port: { type: 'string', short: 'p' },
        environment: { type: 'string', short: 'e', default: 'development' },
    },
};

function parseArgv() {
    const { values } = parseArgs(PARSE_ARGS_OPTIONS);
    const port = values.port ? parseInt(values.port, 10) : undefined;
    return {
        port: Number.isNaN(port) ? undefined : port,
        environment: values.environment ?? 'development',
    };
}

export async function main() {
    const { port, environment } = parseArgv();

    const app = new Application({ applicationDirectory: APP_DIR, environment });

    const configStore = app.createConfigStore();
    const config = await app.loadConfig(configStore);
    const logger = app.createLogger(config);
    const applicationContext = app.createApplicationContext(config, logger);
    await app.loadPlugins(applicationContext);
    const router = app.createHttpRouter(applicationContext);
    const server = app.createHttpServer(applicationContext, port);

    router.on('error', ({ error, requestId }) => {
        const name = error.name || 'NoErrorName';
        const code = error.code ?? 'NoErrorCode';
        const message = error.message || 'NoErrorMessage';
        logger.debug('http route error', { requestId, name, code, message });
    });

    server.on('error', (ev) => {
        logger.error(ev.message, ev.info, ev.cause);
    });

    server.on('info', (ev) => {
        logger.info(ev.message, ev.info);
    });

    server.on('debug', (ev) => {
        logger.debug(ev.message, ev.info);
    });

    server.startServer((request, response) => {
        return router.handleRequest(applicationContext, request, response);
    });
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error('HTTP server start failed:');
        console.error(error);
        process.exit(1);
    });
}
```

## Base Template

Create `templates/base-templates/base.html`. This is the full HTML document that wraps every page. It typically delegates to partials for major sections:

```html
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body>
        {{> site-header.html }}
        <div class="site-content">{{unescape body}}</div>
        {{> site-footer.html }}
    </body>
</html>
```

Create `templates/partials/html-header.html` to handle meta tags and SEO:

```html
<meta charset="utf-8">

<title>{{ title }}</title>

{{#if description}}
    <meta name="description" content="{{ description }}">
{{/if}}

<meta name="viewport" content="width=device-width, initial-scale=1">

{{#if openGraph.type}}
<meta property="og:type" content="{{ openGraph.type }}">
{{/if}}
{{#if openGraph.title}}
<meta property="og:title" content="{{ openGraph.title }}">
{{/if}}
{{#if openGraph.description}}
<meta property="og:description" content="{{ openGraph.description }}">
{{/if}}
{{#if openGraph.url}}
<meta property="og:url" content="{{ openGraph.url }}">
{{/if}}
{{#if openGraph.image}}
<meta property="og:image" content="{{ openGraph.image.url }}">
{{/if}}

{{#if canonicalURL}}
    <link rel="canonical" href="{{ canonicalURL }}" />
{{/if}}

<link rel="stylesheet" href="/css/styles.css">
```

## Home Page

Create `pages/page.jsonc`:

```jsonc
{
    "title": "My App",
    "description": "Welcome to my application."
}
```

Create `pages/page.html`:

```html
<main>
    <h1>Welcome</h1>
    <p>Hello from Kixx!</p>
</main>
```

## Running the Application

```bash
node server.js --environment development --port 3000
```

Or use the environment default:

```bash
node server.js
```

Visit `http://localhost:3000` to see your home page.

## `package.json`

Kixx applications use ES modules. Add `"type": "module"` to your `package.json`:

```json
{
    "name": "my-app",
    "version": "1.0.0",
    "type": "module"
}
```

## Next Steps

- [Configuration](configuration.md) — All configuration options
- [Routing](routing.md) — Define routes for different URL patterns
- [Pages](pages.md) — Build pages with templates and Markdown
- [Request Handling](request-handling.md) — Write custom middleware and handlers
