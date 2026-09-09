# Frontend Development Guide

This guide covers frontend development conventions for this project: where frontend source lives, the live style guide, the public/admin boundary, stylesheet organization, class naming, theming, CSS formatting and comments, the page-local stylesheet pattern, and browser JavaScript.

Related documents:

- `static-assets/README.md` — Static asset serving, fingerprinting, and the content-addressable store.
- `templates/README.md` — Kixx template syntax (interpolation, sections, helpers, partials).
- `app/presentation/README.md` — routing, request handlers, forms, page includes, and the Hyperview file layout.

## Where Frontend Source Lives

```text
src/
├── pages/                        # Route-specific page.json, page.html, body.html, page.css
├── templates/
│   ├── base/                     # Full HTML documents: default.html, admin.html, admin-login.html
│   └── partials/                 # Shared markup fragments
├── static-assets/                # Fingerprinted, comment-stripped browser assets
│   ├── stylesheets/
│   └── javascript/
└── public/                       # Served verbatim from the site root (favicons, webmanifest)
```

The three directories differ in how the publishing tool (outside the scope of this project) treats them:

| Directory | Browser URL | Fingerprinted | Comments stripped |
| --- | --- | --- | --- |
| `static-assets/` | `/stylesheets/**`, `/javascript/**` | Yes, via the `assetUrl` template helper | Yes (`.css` and `.js`) |
| `public/` | `/**` (site root) | No | No |
| `pages/**/page.css` | None — inlined into the HTML | N/A | **No** |

See `static-assets/README.md` for more information about how fingerprinting and the content-addressable store work.

Templates link entrypoints through `assetUrl`, which rewrites the logical pathname to a content-addressed URL when a Release is published and falls back to the bare pathname in development:

```html
<link href="{{ assetUrl assets "/stylesheets/stylesheet.css" }}" rel="stylesheet">
<script type="module" src="{{ assetUrl assets "/javascript/site.js" }}"></script>
```

There is no CSS or browser-JavaScript bundling in development. There is a bundler outside the scope of this project so you do not need to worry about the cost of splitting a stylesheet or module.

See `static-assets/README.md` for more information about how assets are served in development and how `assetUrl` works with the content-addressable store.

## Public Pages Are the Default

This web application provides two entry points:

1. The public website — publicly available on the Web.
2. The admin panel — administrative and content management behind an authentication and access gate.

The public website is the default presentation surface. Public pages use the default base template, `templates/base/default.html`, which links the public stylesheet entrypoint, `/stylesheets/stylesheet.css`.

Admin pages are an extension of the public foundation, not the baseline every page inherits. Admin panel routes opt into their shell with `HyperviewPageHandler({ baseTemplateId: 'admin.html' })` (see `routes/admin-panel.js`), while standalone admin authentication routes use `baseTemplateId: 'admin-login.html'` (see `virtual-hosts.js`). Both admin base templates load `/stylesheets/admin.css`, which imports the public bundle first and then layers admin shell and style-guide rules on top.

### The Home Page Is a Demo, Not a Pattern

`pages/page.{json,html,css}` renders a CSS Zen Garden document. Its markup is fixed by that exercise, so `pages/page.css` styles it with structural element selectors and bespoke grid/flex rules instead of the project's layout primitives, and its masthead uses a bare-`vw` `clamp()`. Read it as a demonstration that the token system can carry an arbitrary design — **not** as a model for new pages. It is meant to be replaced when a fork establishes its own home page.

For the conventions a real page follows, read the style guide pages under `pages/admin/style-guide/` and the shared stylesheets in `static-assets/stylesheets/lib/`.

## Follow the Style Guide

Before writing or reviewing any frontend markup or CSS, check the live style guide at `/admin/style-guide`. It is the design reference and a set of working examples built from the project's own primitives and components:

- Start with `pages/admin/style-guide/aesthetic/body.html` — the tone and design philosophy behind every other section, and specifically what is a *structural rule you keep* versus a *default you are expected to change*.
- Foundations: `typography/`, `colors/`.
- Layout: `layout/`.
- Components: `buttons/`, `cards/`, `forms/`, `text-fields/`, `copy-fields/`, `multi-line-text-areas/`, `callouts/`.

Treat the style guide as the source of truth for aesthetic decisions: color use, type roles, spacing rhythm, component anatomy, and state treatment. Its shell and navigation examples are admin examples; copy those only for admin pages. Public pages should borrow the shared tokens, typography roles, layout primitives, and reusable components without inheriting admin-panel chrome by default.

The style guide ships as a place-holder. When a fork establishes its own aesthetic, update these pages — a component added to `components.css` without a style-guide example is a component the next agent will not find.

## Never Use Inline Styles

Do not use inline `style="..."` attributes in HTML templates. Inline styles bypass the design system, cannot be reused, and scatter presentation decisions across templates instead of keeping them in stylesheets. There are currently zero of them in `pages/` and `templates/`; keep it that way.

When you need styling, resolve it in this order:

1. **Reuse an existing component, utility, or layout primitive.** Most page structure is a composition of the primitives described below.
2. **Extend an existing shared stylesheet.** If nothing fits and the rule is reusable, add a well-named class to the appropriate file in `src/static-assets/stylesheets/lib/`.
3. **Use a page-local `page_stylesheet` include for genuinely localized styles.** When a style truly belongs to one page and is not reusable, supply it through the `page_stylesheet` include instead of an inline `style` attribute. See `app/presentation/README.md` for how page includes work.

This rule also applies to CSS custom properties. Do not tune a component with an inline `style` attribute. Put the custom-property override in a modifier class, a reusable class, or the page's local stylesheet.

## Stylesheet Organization

CSS source lives under `src/static-assets/stylesheets/`. There are two bundles, each with its own entrypoint:

```text
src/static-assets/stylesheets/
├── stylesheet.css          # Public entrypoint — imports the shared foundation
├── admin.css               # Admin entrypoint — imports stylesheet.css, then admin-only files
└── lib/                    # Shared and admin-only library files.
```

`stylesheet.css` imports shared files in dependency order; `admin.css` imports `stylesheet.css` first, then the admin-only files. Keep both bundles ordered from low-level foundations to higher-level components — later files rely on tokens, reset rules, type roles, and primitives defined earlier.

Templates link public logical URLs such as `/stylesheets/stylesheet.css`; source `@import`s use root-relative logical URLs such as `/stylesheets/lib/layout.css`.

Before adding a new file to `lib/`, prefer extending one of the existing files. The project favors a handful of well-documented stylesheets over many small files, so related rules stay close to the examples and comments that explain them — and because each new file is another runtime request.

Do not add admin-only rules to a shared file. If a rule exists only to serve the admin panel, it belongs in one of the admin-specific library files.

## CSS Formatting

- Four spaces for indentation.
- One selector per line when a selector list has multiple selectors.
- One declaration per line.
- No blank lines between rules in a logical group.
- A blank line between adjacent groups of rules.
- Opening braces on the selector line.
- Expanded rule blocks, even for one-declaration modifiers.
- No padded inline comments after declarations; put explanatory comments above the declaration or rule they describe.

Example:

```css
.callout--warning {
    --callout-accent: var(--color-status-warning);
}

.callout--error {
    --callout-accent: var(--color-status-danger);
}
```

Keep selectors readable and low-surprise. Prefer classes over complex structural selectors unless the structure is part of the component contract. Structural selectors are acceptable for primitives like `.with-sidebar > :first-child` because the child relationship is the primitive's API.

There is no CSS linter or formatter in this project; `node run-linter.js` checks JavaScript only, so CSS formatting is enforced by review.

## CSS Comments

The stylesheets are also developer documentation. Verbose comments are acceptable in `static-assets/stylesheets/` because the bundling tool (outside the scope of this project) strips `.css` and `.js` comments when it scans static assets into a Release — production readers never download them.

**That stripping does not apply to page-local CSS.** A `page_stylesheet` include is page content, not a static asset: it is inlined verbatim into a `<style>` element on every HTML response for that page, comments and all. Keep comments in `pages/**/page.css` purposeful and short.

Use a section block for every major file section or public component:

```css
/* -----------------------------------------------------------------------------
    Section title

    Explain what this section owns, when to use it, and any constraints or
    custom properties authors need to understand.
----------------------------------------------------------------------------- */
```

Use short local comments for non-obvious implementation details, browser quirks, accessibility decisions, or intentional tradeoffs. A useful comment explains why the rule exists, what contract it protects, or what would break if it changed. Avoid comments that only restate the declaration.

For component and primitive sections, document the public contract:

- What the class is for.
- When to use it.
- Expected markup structure when relevant.
- Modifier classes.
- Exposed custom properties.
- Important state or accessibility behavior.

## Naming Convention: BEM

Component classes follow Block-Element-Modifier (BEM):

```css
.callout {
    /* block */
}

.callout__body {
    /* element: __ separates block from a part of it */
}

.callout--warning {
    /* modifier: -- separates block from a variant of it */
}
```

BEM in this project is an ownership rule, not just a naming convention:

- **A block owns its internal layout and its elements.** A block never sets its own outside margin — that space belongs to whatever sibling relationship the block sits in (see the `.flow` section of `layout.css`).
- **An element is only ever styled from within its own block's rules.** `.callout__body` is styled in the `.callout` section of `components.css`. No other block's rules may reach into `.callout__body`.
- **A modifier always accompanies its base class in markup** (`class="callout callout--warning"`), never alone. The base class carries the shared rules; the modifier only overrides what varies.
- **Page-local stylesheets may add a new block, a new modifier of an existing block, or a page-scoped rule.** They may not restyle a shared block's elements — that is a page reaching an inconsistent hand into a stylesheet it does not control.
- **Utilities are flat, single-purpose classes**: `.flow`, `.cluster`, `.center`, `.list-unstyled`, `.type-caption`. They are not blocks — they have no elements and no modifiers — they are reusable declaration blocks applied directly to whatever markup needs them. (`.center--form` and `.center--site` are the one exception: `.center` exposes measure presets in modifier form.)

### Tuning Instances with Custom Properties

Prefer a scoped CSS custom property over a new modifier class when only a value changes, not the structure. Components commonly expose their own component token, resolved from a semantic token, so a modifier can change one value without repeating the whole rule:

```css
.callout {
    --callout-accent: var(--color-ink);
    border-left: 3px solid var(--callout-accent);
}

.callout--warning {
    --callout-accent: var(--color-status-warning);
}
```

## Design Tokens

Every design token in the project is defined in `static-assets/stylesheets/lib/design-tokens.css`. That file's header comment indexes the token families, and each family's section comment states its own rules. Read it before adding a token, and add one only when nothing existing fits.

Two rules govern every other stylesheet:

- **A component rule reads a semantic `--color-*` token** — never a raw `--palette-*` token, and never a literal color.
- **References flow one direction only**: component token → semantic token → reference palette token.

The Colors page of the style guide documents the color contract in full.

## Color Scheme and Theming

Light and dark are handled with the native CSS `light-dark()` function, not a duplicated dark-mode stylesheet:

- `:root` in `design-tokens.css` declares `color-scheme: light dark`, and every semantic `--color-*` token resolves as `light-dark(<light value>, <dark value>)`. Define both values once at the semantic tier and everything downstream themes for free.
- A reader's explicit choice is stored in `localStorage` under the key in `window.COLOR_SCHEME_STORAGE_KEY` and applied to `<html>` as `data-color-scheme="light"` or `"dark"` by the inline script in `templates/partials/common-site-meta.html`. That script runs before paint, so the page never flashes the wrong theme.
- `design-tokens.css` translates that attribute back into a `color-scheme` declaration (`:root[data-color-scheme="dark"] { color-scheme: dark; }`), which is what makes `light-dark()` pick the other branch.
- With no attribute set, the page follows the operating system preference.
- The toggle control is `class="button theme-toggle"` with `data-js-behavior="theme-toggle"`; `static-assets/javascript/site.js` owns its click handling and `aria-pressed` state.

**Never write a `prefers-color-scheme` media query for a color.** Put both values in a `light-dark()` semantic token instead; that is the whole point of the tier.

A theme-conditional rule that is *not* a color is the one case that needs more. `light-dark()` only resolves colors, and `[data-color-scheme]` is absent until the reader clicks the toggle, so neither mechanism alone covers both a system preference and an explicit choice. Such a rule has to spell out both branches — the system preference guarded against an explicit opt-out, plus the explicit choice:

```css
@media (prefers-color-scheme: dark) {
    :root:not([data-color-scheme="light"]) body {
        -webkit-font-smoothing: antialiased;
    }
}

:root[data-color-scheme="dark"] body {
    -webkit-font-smoothing: antialiased;
}
```

## Typography

The type system is documented in the style guide at `/admin/style-guide/typography`: Read the style guide page before sizing text.

## Layout Primitives

`static-assets/stylesheets/lib/layout.css` defines the layout primitives. Its header comment lists the family and the rules they share; each primitive's own section comment documents what it is for and the custom properties that tune it. The `/admin/style-guide/layout` page shows them working.

Compose primitives before writing a new `display: flex` or `display: grid` rule. Most page structure should be a nesting of them.

## Composition

Page structure is layout primitives → blocks → elements, in that order of responsibility:

- A layout primitive (`.flow`, `.cluster`, `.with-sidebar`, …) and a block class (`.card`, `.callout`, …) may coexist on the same element — `<div class="card flow">` is the normal, expected composition.
- A layout class never carries block styling, and a block never lays out its siblings — that is the layout primitive's job.
- A block's *internal* layout may use primitives on its own child elements (for example `<div class="callout__body flow">`), but the block itself does not reimplement `gap` or margin spacing that a primitive already provides.
- A block may configure a primitive it composes by setting the primitive's custom property on itself. `.site-header__inner` sets `--cluster-justify: space-between` rather than writing its own flex rules.

## When to Add What

| Situation | Where it goes |
| --- | --- |
| A value changes on one instance, structure stays the same | A scoped CSS custom property override, set on that instance |
| A variant of an existing block | A modifier class (`.block--modifier`) in the block's file |
| A reusable declaration block with no parts | A utility class in `layout.css` or `typography.css` |
| A new reusable component with parts | A new block in `components.css` or `forms.css`, plus a style-guide page |
| Admin shell structure (header, nav, content sections) | `admin-shell.css` |
| Style-guide specimen or documentation chrome | `admin-style-guide.css` |
| Styling that belongs to exactly one page | The page's `page_stylesheet` include |
| A new color or size is needed | Check existing tokens first (`design-tokens.css`); add a token only if nothing fits |
| Behavior that needs the DOM | A `data-js-behavior` block in `static-assets/javascript/site.js` |
| A file the browser must fetch at a fixed root URL (favicon, manifest) | `src/public/` |

## Components and Forms

Reusable components live in `components.css` and `forms.css`. Copy their documented anatomy instead of inventing parallel markup.

Change them through tokens first (`--radius-sm`, `--radius-md`, `--control-radius`, the `--color-*` tier), and through a new modifier class second, before reaching for a one-off override.

## Page-Local Styles via `page_stylesheet`

All three base templates conditionally render a `page_stylesheet` include into a `<style>` element in the document `<head>`:

```html
{{#if includes.page_stylesheet }}
<style>{{{ includes.page_stylesheet }}}</style>
{{/if}}
```

To supply page-local CSS, add a `page_stylesheet` entry to the page's `includes` in its `page.json`, pointing at a CSS file in the same page directory:

```json
{
    "includes": {
        "body": { "filename": "body.html" },
        "page_stylesheet": { "filename": "page.css" }
    }
}
```

`pages/admin/style-guide/colors/` is a working example of this pattern, keeping one-page swatch layout rules out of the shared stylesheets.

Remember that this CSS is inlined into every HTML response for the page and is not comment-stripped or fingerprinted. Keep it small. Reach for `page_stylesheet` only when the styling is specific to one page and is not worth generalizing into `src/static-assets/stylesheets/lib/`.

## Browser JavaScript

Browser JavaScript lives in `src/static-assets/javascript/`:

- `site.js` — the single entrypoint, loaded as `<script type="module">` at the end of `<body>` by every base template.

Behavior is written directly against standard DOM APIs (`querySelectorAll`, `dataset`, `closest`, `addEventListener`, etc.) — there is no DOM helper library.

Conventions:

- **Behavior is attached with `data-js-behavior="<name>"`, never with a styling class.** Styling classes and behavior hooks are separate vocabularies: renaming a CSS class must never break a script, and removing a behavior must never change the look. `site.js` selects on `[data-js-behavior="theme-toggle"]` and `[data-js-behavior="copy-field"]`.
- **Each behavior is a self-contained IIFE in `site.js`.** Add a new behavior as another block rather than adding a second entrypoint — there is no bundler, so each additional module file is another request.
- **Imports are root-relative logical URLs**, e.g. `import formatDate from '/javascript/lib/format-date.js'`. Do not use bare package specifiers; there is no module resolution step for browser code.
- **Progressive enhancement is the contract.** Pages render and forms submit without JavaScript. A behavior that fails — a missing target, a denied clipboard write — must degrade to something usable and, where the failure is a markup bug, `console.warn` and skip that one control instead of throwing and taking every other control down with it.

Browser JavaScript is linted with the rest of the project. `eslint.config.js` treats `src/pages/`, `src/public/`, `src/static-assets/`, and `src/templates/` as browser code: ES modules, `ecmaVersion: 2017`, and an explicit globals allowlist. A global that is not on that list is a lint error, so using a new browser API means adding it to the allowlist in `eslint.config.js` in the same change.

The JavaScript conventions in `docs/code-style-guide.md` and `docs/code-documentation-guide.md` are for server side JavaScript and *do not* apply to JavaScript in the browser.

## Verifying Frontend Work

- Run the development server with `node tools/devserver.js --port 2026`. Template, page-data, and `static-assets/` changes are picked up without a restart.
- Append `.json` to any page URL to inspect the template context object, including resolved includes: `http://localhost:2026/index.json`.
- Run `node run-linter.js src/static-assets/javascript` after changing browser JavaScript. CSS and HTML are not linted.
