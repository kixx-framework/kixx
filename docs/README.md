# Kixx Framework Documentation

Kixx is a framework for building server-rendered, hypermedia-driven web applications. It emphasizes HTML as the engine of application state, keeping client-side JavaScript minimal while providing a structured, productive server-side development experience.

## Core Concepts

- **Server-rendered HTML** — All pages are rendered on the server using templates and optional Markdown content.
- **Convention over configuration** — URL paths map directly to page directories; sensible defaults minimize boilerplate.
- **Object-oriented, modular design** — Framework modules are imported directly from the `lib/` directory.
- **No npm install** — Kixx is not published to npm. Copy or reference the `lib/` directory directly in your project.

## Documentation

| Guide | Description |
|---|---|
| [Getting Started](getting-started.md) | Set up a new Kixx application from scratch |
| [Configuration](configuration.md) | Config files, environments, and secrets |
| [Routing](routing.md) | Virtual hosts, routes, targets, and URL patterns |
| [Pages](pages.md) | Hyperview pages: templates, data, and Markdown |
| [Error Pages](error-pages.md) | Custom error pages for 404, 500, and other HTTP errors |
| [Request Handling](request-handling.md) | Middleware, handlers, and the request/response API |
| [Static Files](static-files.md) | Serving static assets from the `public/` directory |

## Project Layout

A typical Kixx application has this directory structure:

```
my-app/
├── kixx/                           # Kixx framework source (copied from kixx/lib/)
│
├── lib/                            # Application library (your own code)
│   └── application.js              # App setup class (optional but recommended)
│
├── plugins/                        # Kixx plugin modules
│   ├── mod.js                      # Plugin registry
│   └── hyperview/
│       └── plugin.js               # Hyperview plugin (register + initialize)
│
├── pages/                          # Page content (one directory per URL path)
│   ├── page.jsonc                  # Home page data  (URL: /)
│   ├── page.html                   # Home page template
│   ├── about/
│   │   ├── page.jsonc
│   │   └── page.html
│   └── blog/
│       └── my-first-post/
│           ├── page.jsonc
│           ├── page.html
│           └── body.md
│
├── templates/
│   ├── base-templates/             # Layout wrappers (full HTML document)
│   │   └── base.html
│   ├── partials/                   # Reusable template fragments
│   │   ├── html-header.html
│   │   ├── site-header.html
│   │   └── site-footer.html
│   └── helpers/                    # Custom template helper functions
│       └── my-helper.js
│
├── public/                         # Static files (CSS, images, fonts, etc.)
│   ├── favicon.ico
│   └── images/
│
├── routes/
│   └── main.js                     # Route definitions
│
├── virtual-hosts.js                # Hostname-to-routes mapping
├── kixx-config.jsonc               # Application configuration
├── .secrets.jsonc                  # Secrets (exclude from version control)
└── server.js                       # Application entry point
```

## Requirements

- Node.js >= 24
