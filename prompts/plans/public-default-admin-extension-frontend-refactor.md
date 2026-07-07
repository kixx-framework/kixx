# Public Default / Admin Extension Frontend Refactor

## Implementation Approach

Make the public website the default presentation path by keeping `templates/base/default.html`, `templates/pages/page.html`, `src/pages/body.html`, and `/stylesheets/stylesheet.css` free of admin-panel shell assumptions. Move admin-panel layout, navigation, and style-guide demo chrome behind explicit admin entrypoints so admin pages opt into the extension through `baseTemplate` and an admin stylesheet partial. Preserve the existing shared design foundations, including tokens, reset, typography, layout primitives, forms, buttons, cards, callouts, wordmark, and theme toggle, so the refactor changes ownership boundaries without rebuilding the visual system. Keep route behavior unchanged unless implementation discovers that a base-template default must be provided by `page.json`; admin pages already opt into `admin.html` or `admin-login.html`.

- [x] **Define the public/admin frontend contract**
  - **Story**: Public default / admin extension documentation
  - **What**: Update the frontend guide so it describes public pages as the default, admin pages as an opt-in extension, and the admin style guide as the reference for admin-shell and shared component examples rather than proof that every page is an admin panel.
  - **Where**: `src/docs/frontend-development-guide.md`
  - **Documentation**: `README.md`, `src/docs/frontend-development-guide.md`, `src/app/presentation/README.md`, `src/templates/README.md`
  - **Acceptance criteria**: The guide names `templates/base/default.html` and `/stylesheets/stylesheet.css` as the public defaults; admin pages are documented as using `baseTemplate: "admin.html"` or `baseTemplate: "admin-login.html"`; the stylesheet organization section names the admin stylesheet entrypoint and admin-only CSS files.
  - **Depends on**: none

- [x] **Add an admin stylesheet entrypoint**
  - **Story**: Admin extension stylesheet ownership
  - **What**: Add `/stylesheets/admin.css` as the admin-panel bundle. It should import the public/shared foundation bundle first, then import admin-only shell and style-guide CSS.
  - **Where**: `src/stylesheets/admin.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`, `src/app/presentation/README.md`
  - **Acceptance criteria**: Admin pages can load one admin stylesheet; shared public foundations still come from `/stylesheets/stylesheet.css`; admin-only selectors are not required by the public stylesheet entrypoint.
  - **Depends on**: Define the public/admin frontend contract

- [x] **Split admin shell CSS out of shared layout**
  - **Story**: Admin extension stylesheet ownership
  - **What**: Move admin shell rules out of the shared layout file into a new admin shell stylesheet, and rename the public-looking shell selectors to admin-owned names.
  - **Where**: `src/stylesheets/lib/layout.css`, `src/stylesheets/lib/admin-shell.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`, `src/templates/README.md`
  - **Acceptance criteria**: `.with-sidebar`, `.flow`, `.cluster`, `.grid-auto`, `.switcher`, and `.center` remain shared primitives; admin shell rules use names such as `.admin-layout`, `.admin-main`, `.admin-header`, `.admin-nav`, and `.admin-content-section`; `body:has(...)` height behavior keys off the admin layout class, not `.site-layout`.
  - **Depends on**: Add an admin stylesheet entrypoint

- [x] **Split style-guide demo CSS out of shared components**
  - **Story**: Admin style guide as admin extension
  - **What**: Move style-guide-only demo/documentation rules out of the shared components stylesheet into an admin style-guide stylesheet.
  - **Where**: `src/stylesheets/lib/components.css`, `src/stylesheets/lib/admin-style-guide.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`, `src/templates/README.md`
  - **Acceptance criteria**: Shared component CSS keeps reusable components like `.button`, `.card`, `.callout`, `.kixx-wordmark`, `.theme-toggle`, and form-adjacent shared pieces; style-guide-only classes such as `.doc-prose`, `.demo-stage`, `.specimen-*`, `.swatch-*`, `.state-list`, `.code-block`, and `.card-gallery` load only through the admin bundle.
  - **Depends on**: Add an admin stylesheet entrypoint

- [x] **Wire admin base templates to the admin bundle**
  - **Story**: Admin pages explicitly opt into admin layout
  - **What**: Add an admin stylesheet partial and update admin base templates to use it. Rename admin shell markup classes from `site-*` to `admin-*` to match the admin CSS boundary.
  - **Where**: `src/templates/partials/admin-site-styles.html`, `src/templates/base/admin.html`, `src/templates/base/admin-login.html`
  - **Documentation**: `src/app/presentation/README.md`, `src/templates/README.md`, `src/docs/frontend-development-guide.md`
  - **Acceptance criteria**: `admin.html` and `admin-login.html` link the admin stylesheet; public `default.html` still links the public stylesheet; admin headers/layouts no longer use generic `site-header`, `site-layout`, or `site-main` class names.
  - **Depends on**: Split admin shell CSS out of shared layout

- [x] **Rename admin page shell classes**
  - **Story**: Admin pages explicitly opt into admin layout
  - **What**: Update admin page templates and style-guide page includes to use the renamed admin shell, nav, main, and content-section classes.
  - **Where**: `src/templates/pages/admin/**/*.html`, `src/templates/pages/login/admin/**/*.html`, `src/templates/pages/users/admin/**/*.html`, `src/pages/admin/style-guide/**/*.html`, `src/pages/admin/style-guide/**/*.css`
  - **Documentation**: `src/templates/README.md`, `src/docs/frontend-development-guide.md`
  - **Acceptance criteria**: No admin template depends on `site-nav`, `site-main`, or `content-section`; style-guide pages still render their navigation, sticky sidebar, section spacing, demo stages, and page-local CSS correctly through admin-owned class names.
  - **Depends on**: Wire admin base templates to the admin bundle, Split style-guide demo CSS out of shared components

- [x] **Simplify the public generic page template**
  - **Story**: Public pages are the default route surface
  - **What**: Remove the admin/style-guide-flavored onboarding callout header from the generic page template and leave the template focused on rendering public page content. Keep any wrapper class public-neutral and only where the current homepage layout needs it.
  - **Where**: `src/templates/pages/page.html`
  - **Documentation**: `src/app/presentation/README.md`, `src/templates/README.md`, `src/docs/frontend-development-guide.md`
  - **Acceptance criteria**: The root page no longer renders admin-style callout cards above `src/pages/body.html`; the generic page template does not include admin-only classes or copy; `includes.body` continues to render as trusted page content.
  - **Depends on**: Split style-guide demo CSS out of shared components

- [x] **Keep the homepage CSS public-local**
  - **Story**: Public homepage remains the default example
  - **What**: Update the root page-local stylesheet after the generic template cleanup, removing orphaned `.page-header` rules and making any remaining wrapper/layout classes clearly homepage/public scoped.
  - **Where**: `src/pages/page.css`, `src/pages/body.html`
  - **Documentation**: `src/docs/frontend-development-guide.md`, `src/app/presentation/README.md`
  - **Acceptance criteria**: The CSS Zen Garden homepage still renders from `src/pages/body.html`; its page-local CSS has no admin shell dependencies; the stylesheet only contains rules used by the public homepage.
  - **Depends on**: Simplify the public generic page template

- [x] **Confirm page metadata communicates opt-in layout**
  - **Story**: Public pages are default, admin pages are explicit
  - **What**: Review root and admin `page.json` files so public pages inherit or explicitly use the public default and admin pages continue to declare admin base templates at the nearest useful ancestor.
  - **Where**: `src/pages/page.json`, `src/pages/admin/**/*.json`, `src/pages/login/admin/**/*.json`, `src/pages/users/admin/**/*.json`
  - **Documentation**: `src/app/presentation/README.md`, `src/templates/README.md`
  - **Acceptance criteria**: Public root metadata does not imply an admin layout; every admin route that needs admin chrome still resolves to `admin.html` or `admin-login.html`; inherited admin style-guide metadata remains clear and intentional.
  - **Depends on**: Wire admin base templates to the admin bundle, Simplify the public generic page template

- [x] **Verify rendered public and admin pages**
  - **Story**: Refactor preserves behavior
  - **What**: Run the development server and inspect representative public and admin pages, including JSON contexts where useful. Do not add or run unit tests unless explicitly asked.
  - **Where**: `src/pages/body.html`, `src/templates/base/default.html`, `src/templates/base/admin.html`, `src/templates/base/admin-login.html`, `src/templates/pages/page.html`, `src/stylesheets/**/*.css`
  - **Documentation**: `README.md`, `src/docs/frontend-development-guide.md`, `src/app/presentation/README.md`
  - **Acceptance criteria**: `/` renders as a public homepage without admin chrome; `/admin/style-guide` renders with admin navigation and style-guide demo styles; `/login/admin/new` renders as an admin auth page; `/index.json` shows the expected root page context; no JavaScript lint is needed unless implementation changes JavaScript source files.
  - **Depends on**: Confirm page metadata communicates opt-in layout
