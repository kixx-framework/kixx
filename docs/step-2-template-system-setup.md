# Step 2: Template System Setup

## Overview

The template system is the foundation of hypermedia-driven applications in Kixx. It provides server-side rendering with a simple, powerful templating language that supports partials, helpers, and data binding. Templates are the primary mechanism for generating HTML responses that include embedded state transitions.

For more information see [Templating with Kixx](./templating-with-kixx.md).

## Template Architecture

```
templates/
├── templates/
│   └── base.html          # Main layout template
├── partials/
│   ├── html-header.html   # HTML head section
│   ├── site-header.html   # Navigation header
│   ├── site-footer.html   # Footer
│   └── components/        # Reusable components
└── helpers/
    ├── format_date.js     # Date formatting helper
    └── custom_helpers.js  # Custom helper functions
```

## Base Template

### templates/templates/base.html

The base template defines the overall HTML structure and includes common elements like the head section, header, and footer.

An example base template:

```html
<!doctype html>
<html lang="en-US">
    <head>
        {{> html-header.html }}
    </head>
    <body id="site-layout">
        {{> site-header.html }}
        <!--
            START Main Content Container
            Notice that we use the `noop` helper to avoid escaping HTML entities in the
            body value, since the body value contains the main HTML content of the template.
        -->
        <div class="page-body">{{noop body }}</div>
        <!-- END Main Content Container -->
        {{> site-footer.html }}
    </body>
</html>
```
## Next Steps

After setting up the template system, proceed to:

- [Step 3: Page Structure](./step-3-page-structure.md)
- [Step 4: Routing Configuration](./step-4-routing-configuration.md)
- [Step 5: Custom Plugins](./step-5-custom-plugins.md) 
- [Templating with Kixx](./templating-with-kixx.md);