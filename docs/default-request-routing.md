# Default Request Routing
Using only the default routing and request handling provided by Kixx you can serve many common use cases with no custom code.

## Directory Structure
A typical Kixx app should look like this:

```
my-app/
├── kixx-config.json           # Main app config
├── virtual-hosts.json         # Virtual host and route config
├── site-page-data.json        # Site-wide data for templates
├── pages/                     # Page templates and data (mirrors URL structure)
│   ├── page.html              # Home page (/)
│   ├── about/
│   │   ├── page.html          # /about
│   │   └── page.json          # Data for /about
│   └── ...
├── public/                    # Static assets (CSS, JS, images)
│   └── ...
├── templates/
│   ├── templates/
│   │   └── base.html          # Base HTML template
│   ├── partials/              # Template partials
│   └── helpers/               # Template helpers
└── routes/ (optional)         # Only needed for custom routes
```

## Static Files
- **URL:** `/assets.css`, `/logo.png`, etc.
- **Handler:** `StaticFileServer`
- **Behavior:**
  - If the request matches a file in `public/`, it is served directly.
  - Security checks prevent directory traversal and invalid paths.
  - Caching headers and content-type are set automatically.

## Pages (Catch-All)
- **URL:** Any other path (e.g., `/`, `/about`, `/products/item`)
- **Handler Chain:** `StaticFileServer` → `PageHandler`
- **Behavior:**
  1. **StaticFileServer** tries to serve a file from `public/`.
     - If found, serves the file and ends the request.
     - If not found, continues to next handler.
  2. **PageHandler** attempts to render a page:
     - Maps the URL to a file in `pages/` (e.g., `/about` → `pages/about/page.html`)
     - Loads optional `page.json` for data, merges with `site-page-data.json`
     - Renders using the base template and partials
     - Returns HTML (or JSON if requested)

See [Templating with Kixx](./templating-with-kixx.md) for more information about authoring your templates.

### Page Matching Structure
- Each URL path maps directly to a folder in `pages/`.
  - `/` → `pages/page.html`
  - `/about` → `pages/about/page.html`
  - `/locations/ithaca` → `pages/locations/ithaca/page.html`
- The `page.json` files provide data for each page while the `site-page-data.json` file provides global page data.

## Error Handling
- **Handler:** `PageErrorHandler`
- **Behavior:**
  - If a page or file is not found, or an error occurs, renders an error page using the templating system.
  - Looks for `pages/{statusCode}/page.html` (e.g., `pages/404/page.html`), or falls back to a default error page.

## What You Need to Do (No Custom Code Required)

To use only the default routing and request handling:

1. **Place your static assets** in `public/`.
2. **Create your pages** in `pages/`, following the desired URL structure.
3. **Add page data** in `page.json` files for each page.
4. **Set up your base template and partials** in `templates/`.

See [Templating with Kixx](./templating-with-kixx.md) for more information about authoring your templates.

## What goes in the page.json file?
The `page.json` file, also known as the "page data" file contains any static data you'd like your page to have access to. Typically this would be things like title, description, and [Open Graph](https://ogp.me/) metadata. But you could put anything in there like URLs for images or stylesheets, or full page content. You can go so far as to implement your own content management system from your page data files.

For every request made to your application which uses the "kixx.PageHandler" the template context will be the result of:

1. Global page data defined in `site-page-data.json`.
2. Local page data defined in the matched `page.json` file.

The merge order to create a template context goes like this:

The __global page data__ is overridden by __local page data__.

## What goes in the page.html file?
The `page.html` file is the template for your new page. It will be interpreted as a Kixx mustache template, but it can be just plain HTML if that suits your needs. In either case the rendered contents of the `page.html` file will become the template context `body` attribute and will get passed into your base template.

See [Templating with Kixx](./templating-with-kixx.md) for more information about authoring your templates.
