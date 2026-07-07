# Frontend Development Guide

This guide covers the frontend development conventions for this project: the live style guide, code organization guidelines, the `stylesheets/` directory, class naming, design tokens, and the page-local stylesheet pattern. For Hyperview template syntax, see `templates/README.md`. For where presentation-layer files live and how request handlers pass render data to templates, see `app/presentation/README.md`.

## Follow the Style Guide

Before writing or reviewing any frontend markup or CSS, check the live style guide. It is both the design reference and a set of working examples built from the project's own primitives and components:

- Start with `pages/admin/style-guide/aesthetic` — the tone and design philosophy behind every other section.
- Browse the full guide in `pages/admin/style-guide/`.

Treat the style guide as the source of truth for aesthetic decisions (color use, type roles, spacing rhythm, component anatomy) rather than re-deriving them from first principles per page.

## Never Use Inline Styles

Do not use inline `style="..."` attributes in HTML templates. Inline styles bypass the design system, cannot be reused, and scatter presentation decisions across templates instead of keeping them in the stylesheets.

When you need styling, resolve it in this order:

1. **Reuse an existing component, utility, or layout primitive.** Most page structure is a composition of the primitives described below — reach for one before writing any new CSS.
2. **Propose a new generic utility or component.** If nothing fits, add a reusable, multi-use class to the appropriate stylesheet (see [File Organization](#file-organization) below) rather than a one-off rule. Name it for the concept it represents so other pages can use it too. Avoid single-use classes that only exist to dodge an inline style.
3. **Use a page-local `page_stylesheet` include for genuinely localized styles.** When a style truly belongs to one page and is not reusable, supply it through the `page_stylesheet` include instead of an inline `style` attribute — see [Page-Local Styles](#page-local-styles-via-page_stylesheet) below.

## File Organization

CSS lives under `stylesheets/`, served directly by the development server. Here is an example of a stylesheets/ directory structure:

```text
stylesheets/
├── admin.css
├── website.css
└── lib/
    ├── design-tokens.css
    ├── reset.css
    ├── standard-include.css
    ├── admin-layout.css
    └── admin-components.css
```

Bundle entry points are in the root of the stylesheets/ directory — each is a flat list of `@import` statements, and import order matters because later files can rely on custom properties and reset rules defined earlier. Here are two examples:

**admin.css**

```css
@import "./lib/design-tokens.css";
@import "./lib/reset.css";
@import "./lib/standard-include.css";
@import "./lib/admin-layout.css";
@import "./lib/admin-components.css";
```

**website.css**
```css
/* website.css */
@import "./lib/design-tokens.css";
@import "./lib/reset.css";
@import "./lib/standard-include.css";
```

Before adding a new file to `lib/`, prefer extending one of the existing ones — the project favors a handful of well-organized files over many small ones, so related rules stay next to each other and the `@import` list stays short. Introduce a new `lib/` file only when a section grows large enough that it earns its own concern (as `admin-layout.css` did for the app shell).

## Naming Convention: BEM

Component classes follow Block-Element-Modifier (BEM):

```css
.callout { }          /* block */
.callout__body { }    /* element: __ separates block from a part of it */
.callout--warning { } /* modifier: -- separates block from a variant of it */
```

An element name is only ever attached to its own block (`.callout__body`, not `.body`). A modifier always sits alongside its block's base class in markup (`class="callout callout--warning"`), never alone — the base class carries the shared rules, and the modifier only overrides what varies.

Utility classes (the layout primitives and type roles described below) are flat, single-purpose names without BEM structure — `.flow`, `.cluster`, `.type-label` — because they are not components with internal parts, just one reusable declaration block.

### Tuning Instances with Custom Properties

Prefer a scoped CSS custom property over a new modifier class when only a value changes, not the structure. Components commonly expose their own token, resolved from a shared design token, that a modifier class or an inline `style` on a specific instance can override:

```css
.callout {
    --callout-accent: var(--color-ink-primary);
    border: var(--accent-border-width) solid var(--callout-accent);
}
.callout--warning { --callout-accent: var(--color-status-warning); }
```

This keeps the modifier declaration to a single custom-property assignment instead of repeating the whole rule, and it is how the layout primitives (see below) expose their own tuning points, like `--sidebar-width` or `--switcher-threshold`.

## Design Tokens

`design-tokens.css` defines a three-tier custom-property system. References flow one direction only — a component rule never names a raw `--palette-*` token or a literal color:

```text
component token  →  semantic token  →  reference (palette) token
```

- **Tier 1 · Reference palette** (`--palette-*`) — raw, theme-agnostic values. The only place a literal color (`hsl()`, hex) may appear.
- **Tier 2 · Semantic** (`--color-*`) — role- and theme-aware, resolved from the palette (often via `light-dark()`). This is the tier component rules should read.
- **Tier 3 · Component** (`--color-button-bg-primary`, etc., plus component-scoped tokens like `--callout-accent` defined next to their component) — resolved here, or inline in the component's own rule, so the component declaration stays declarative.

The full palette, semantic roles, and rationale (contrast requirements, light/dark behavior) are documented in the Colors section of the style guide (`pages/admin/style-guide/colors/`) — read that page before adding a new color token or reaching past the semantic tier.

The same tiered approach applies to spacing (`--space-*` scale, consumed by `.flow`), type scale (`--text-*`, `--leading-*`, `--tracking-*`, `--weight-*`), and structural values (`--radius-*`, border widths). See the Typography and Layout sections of the style guide for the rationale behind each scale.

## Layout Primitives

`standard-include.css` defines a small family of composable, single-purpose layout primitives in the Every Layout tradition (Heydon Pickering / Andy Bell). Each is one class tuned by its own scoped custom properties, which default to design tokens:

| Class | Purpose |
| --- | --- |
| `.flow` | Vertical stack with parent-owned gap between siblings, tuned by `--flow-space` |
| `.cluster` | Horizontal group that wraps; gap-driven, tuned by `--cluster-space` |
| `.grid-auto` | Auto-fit responsive grid, tracks never below `--grid-min` |
| `.switcher` | Row that flips to a column below `--switcher-threshold`, no media query |
| `.with-sidebar` | Fixed-ish sidebar beside fluid content; wraps when tight, tuned by `--sidebar-width` |
| `.center` | Caps a column to `--center-max` and centers it |

Compose these before writing a new `display: flex` or `display: grid` rule — most page structure in this project is a nesting of the six. Because `.flow` uses `gap`, nested `.flow` elements are safe: the outer flow controls the nested element's outside spacing, and the inner flow controls spacing between its own children. Read the comment block above each primitive in `standard-include.css` for the specific reasoning (why a breakpoint is or isn't used, what each custom property controls), and see the Layout section of the style guide (`pages/admin/style-guide/layout/`) for live, annotated examples.

When a primitive needs shell-specific defaults — for example, `.site-layout` sets `--sidebar-content-min` for the admin app shell built on `.with-sidebar` — scope those defaults to the specific class in `admin-layout.css` rather than changing the primitive's own defaults in `standard-include.css`. The primitive itself should stay generically reusable; per-shell opinions belong in the file that owns that shell.

## Page-Local Styles via `page_stylesheet`

Most base templates conditionally render a `page_stylesheet` include into a `<style>` element in the document `<head>`:

```html
{{#if includes.page_stylesheet }}
<style>{{ includes.page_stylesheet }}</style>
{{/if}}
```

To supply page-local CSS, add a `page_stylesheet` entry to the page's `includes` in its `page.json`, pointing at a CSS file in the same page directory:

```json
{
    "includes": {
        "page_stylesheet": { "filename": "page.css" }
    }
}
```

`pages/admin/style-guide/colors/` is a working example of this pattern: `colors/page.json` includes both `body.html` (the page content) and `page.css` (styling specific to that one page), keeping the page's one-off layout rules out of the shared stylesheets entirely.

This is the supported pattern for localized styles — it is the third option in the [style resolution order](#never-use-inline-styles) above, after reusing an existing primitive/component and after proposing a new shared utility. Reach for `page_stylesheet` only when the styling is specific to one page and not worth generalizing.
