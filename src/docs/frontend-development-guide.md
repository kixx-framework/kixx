# Frontend Development Guide

This guide covers the frontend development conventions for this project: the live style guide, source stylesheet organization, class naming, design tokens, CSS formatting, CSS comments, and the page-local stylesheet pattern. For Hyperview template syntax, see `templates/README.md`. For where presentation-layer files live and how request handlers pass render data to templates, see `app/presentation/README.md`.

## Follow the Style Guide

Before writing or reviewing any frontend markup or CSS, check the live style guide. It is both the design reference and a set of working examples built from the project's own primitives and components:

- Start with `pages/admin/style-guide/aesthetic/body.html` — the tone and design philosophy behind every other section.
- Read the source files under `pages/admin/style-guide/` when you need concrete markup examples.

Treat the style guide as the source of truth for aesthetic decisions: color use, type roles, spacing rhythm, component anatomy, and state treatment. Do not re-derive these choices from first principles per page.

## Never Use Inline Styles

Do not use inline `style="..."` attributes in HTML templates. Inline styles bypass the design system, cannot be reused, and scatter presentation decisions across templates instead of keeping them in stylesheets.

When you need styling, resolve it in this order:

1. **Reuse an existing component, utility, or layout primitive.** Most page structure is a composition of the primitives described below.
2. **Extend an existing shared stylesheet.** If nothing fits and the rule is reusable, add a well-named class to the appropriate file in `stylesheets/lib/`.
3. **Use a page-local `page_stylesheet` include for genuinely localized styles.** When a style truly belongs to one page and is not reusable, supply it through the `page_stylesheet` include instead of an inline `style` attribute. See app/presentation/README.md to learn how to use page includes.

This rule also applies to CSS custom properties. Do not tune a component with an inline `style` attribute. Put the custom-property override in a modifier class, a reusable class, or the page's local stylesheet.

## File Organization

CSS lives under `stylesheets/`, served directly by the development server. The shared stylesheet bundle currently has one public entrypoint:

```text
stylesheets/
├── stylesheet.css
└── lib/
    ├── design-tokens.css
    ├── reset.css
    ├── typography.css
    ├── layout.css
    ├── components.css
    └── forms.css
```

`templates/partials/common-site-styles.html` links `/stylesheets/stylesheet.css`. That entrypoint is a flat list of imports, and import order matters because later files rely on custom properties and base rules defined earlier:

```css
@import "./lib/design-tokens.css";
@import "./lib/reset.css";
@import "./lib/typography.css";
@import "./lib/layout.css";
@import "./lib/components.css";
@import "./lib/forms.css";
```

Keep the bundle ordered from low-level foundations to higher-level components:

- `design-tokens.css` owns the palette, semantic tokens, component tokens, spacing, type scale, measures, radii, and border widths.
- `reset.css` owns low-specificity browser normalization and base element behavior.
- `typography.css` owns type roles, matching `.type-*` utilities, inline code, keyboard keys, and blockquotes.
- `layout.css` owns the app shell layout, reusable layout primitives, and shared content-section structure.
- `components.css` owns style-guide demo chrome plus reusable theme components such as navigation, wordmark, theme toggle, buttons, cards, callouts, and site header.
- `forms.css` owns form fields, text areas, and copy fields.

Before adding a new file to `lib/`, prefer extending one of the existing files. The project favors a handful of well-documented stylesheets over many small files, so related rules stay close to the examples and comments that explain them.

## CSS Formatting

Use the formatting already present in `stylesheets/`:

- Four spaces for indentation.
- One selector per line when a selector list has multiple selectors.
- One declaration per line.
- A blank line between adjacent rules.
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

## CSS Comments

The source stylesheets are also developer documentation. Verbose comments are acceptable because comments are stripped from production build output.

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

An element name is only ever attached to its own block (`.callout__body`, not `.body`). A modifier always sits alongside its block's base class in markup (`class="callout callout--warning"`), never alone. The base class carries the shared rules, and the modifier only overrides what varies.

Utility classes are flat, single-purpose names without BEM structure: `.flow`, `.cluster`, `.center`, `.type-label`. They are not components with internal parts; they are reusable declaration blocks.

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

The same pattern is used by layout primitives. For example, `.grid-auto` exposes `--grid-min` and `--grid-space`, `.cluster` exposes `--cluster-space`, and `.center` exposes `--center-max`.

## Design Tokens

`design-tokens.css` defines a three-tier custom-property system. References flow one direction only:

```text
component token  ->  semantic token  ->  reference palette token
```

- **Tier 1 · Reference palette** (`--palette-*`) — raw, theme-agnostic values. This is the only place literal colors such as `hsl()` belong.
- **Tier 2 · Semantic** (`--color-*`) — role- and theme-aware tokens resolved from the palette, often with `light-dark()`. Component rules should read from this tier.
- **Tier 3 · Component** (`--field-border-width`, `--color-field-border`, `--button-border-width`, component-scoped tokens like `--callout-accent`) — resolved component values that keep component declarations declarative.

A component rule must not name a raw `--palette-*` token or a literal color. Use semantic tokens for foregrounds, backgrounds, rules, status marks, focus outlines, and selection colors.

The same tiered thinking applies to spacing (`--space-*`), measures (`--measure-*`), type scale (`--text-*`, `--leading-*`, `--tracking-*`, `--weight-*`), radii, and border widths. Read the comments in `design-tokens.css` and the relevant style-guide pages before adding a new token.

## Typography

Choose heading levels for document structure first. If the semantic level is correct but the visual size is wrong, apply the matching `.type-*` utility rather than changing the heading level.

Do not use color, italics, negative tracking, or decoration to create hierarchy. Hierarchy comes from size, weight, spacing, and structure. Type sizes are fixed rem steps so browser zoom remains predictable; do not introduce fluid font sizing.

## Layout Primitives

`layout.css` defines a small family of composable, single-purpose layout primitives in the Every Layout tradition. Each is one class tuned by scoped custom properties:

| Class | Purpose |
| --- | --- |
| `.flow` | Vertical stack with parent-owned gap between direct children, tuned by `--flow-space` |
| `.cluster` | Horizontal group that wraps, tuned by `--cluster-space`, `--cluster-align`, and `--cluster-justify` |
| `.grid-auto` | Auto-fit responsive grid, tuned by `--grid-min` and `--grid-space` |
| `.switcher` | Row that flips to one item per row below `--switcher-threshold`, no media query |
| `.with-sidebar` | Fixed-ish sidebar beside fluid content, tuned by `--sidebar-width`, `--sidebar-content-min`, and `--sidebar-space` |
| `.center` | Measured centered column, tuned by `--center-max` |

Compose these before writing a new `display: flex` or `display: grid` rule. Most page structure should be a nesting of these primitives.

Because `.flow` uses `gap`, nested `.flow` elements are safe: the outer flow controls the nested element's outside spacing, and the inner flow controls spacing between its own children. If one child needs exceptional outside spacing, make that exception explicit with a component rule or page-local style.

When a primitive needs shell-specific defaults, scope those defaults to the shell class. For example, `.site-layout` sets `--sidebar-content-min` for the app shell built on `.with-sidebar`; the primitive itself stays generally reusable.

## Components and Forms

Reusable components live in `components.css` and `forms.css`. Copy their documented anatomy instead of inventing parallel markup.

Component state should be visible, semantic, and restrained. Buttons invert or shift border color; destructive actions use the danger signal; focus uses `--color-focus-outline`; cards and callouts remain flat, square, and hairline-ruled. Do not add shadows, decorative gradients, rounded card treatments, or ornamental color fills unless the style guide has first established that pattern.

## Page-Local Styles via `page_stylesheet`

Most base templates conditionally render a `page_stylesheet` include into a `<style>` element in the document `<head>`:

```html
{{#if includes.page_stylesheet }}
<style>{{{ includes.page_stylesheet }}}</style>
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

`pages/admin/style-guide/colors/` is a working example of this pattern: `colors/page.json` includes both `body.html` and `page.css`, keeping one-page layout rules out of the shared stylesheets.

This is the supported pattern for localized styles. Reach for `page_stylesheet` only when the styling is specific to one page and is not worth generalizing into `stylesheets/lib/`.
