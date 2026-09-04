# Frontend Development Guide

This guide covers the frontend development conventions for this project: the live style guide, public and admin layout boundaries, source stylesheet organization, class naming, design tokens, CSS formatting, CSS comments, and the page-local stylesheet pattern. For template syntax, see `templates/README.md`. For presentation-layer and HTTP middleware and request handlers, see `app/presentation/README.md`.

## Public Pages Are the Default

This web application provides two different entry points for users:

1. The public website - Publicly available on the Web
2. Admin panel - Administrative and content management "backend" behind an authentication and access gate.

The public website is the default presentation surface. Static public pages should use the default base template, `templates/base/default.html`, which links the public stylesheet entrypoint, `/stylesheets/stylesheet.css`, directly. The current homepage is the canonical example of this default path: root page metadata in `pages/page.json`, route-level markup in `pages/page.html`, public page content in `pages/body.html`, and page-local CSS in `pages/page.css`.

Admin pages are an extension of the public foundation, not the baseline every page inherits. Admin panel routes opt into their shell with `HyperviewPageHandler({ baseTemplateId: 'admin.html' })`, while standalone admin authentication routes use `baseTemplateId: 'admin-login.html'`. Those admin base templates load the admin stylesheet entrypoint, `/stylesheets/admin.css`, which layers admin shell and style-guide rules over the shared public foundations.

## Follow the Style Guide

Before writing or reviewing any frontend markup or CSS, check the live style guide. It is the design reference and a set of working examples built from the project's own primitives and components:

- Start with `pages/admin/style-guide/aesthetic/body.html` — the tone and design philosophy behind every other section.
- Read the source files under `pages/admin/style-guide/` when you need concrete markup examples.

Treat the style guide as the source of truth for aesthetic decisions: color use, type roles, spacing rhythm, component anatomy, and state treatment. Its shell and navigation examples are admin examples; copy those only for admin pages. Public pages should borrow the shared tokens, typography roles, layout primitives, and reusable components without inheriting admin-panel chrome by default.

## Never Use Inline Styles

Do not use inline `style="..."` attributes in HTML templates. Inline styles bypass the design system, cannot be reused, and scatter presentation decisions across templates instead of keeping them in stylesheets.

When you need styling, resolve it in this order:

1. **Reuse an existing component, utility, or layout primitive.** Most page structure is a composition of the primitives described below.
2. **Extend an existing shared stylesheet.** If nothing fits and the rule is reusable, add a well-named class to the appropriate file in `src/static-assets/stylesheets/lib/`.
3. **Use a page-local `page_stylesheet` include for genuinely localized styles.** When a style truly belongs to one page and is not reusable, supply it through the `page_stylesheet` include instead of an inline `style` attribute. See app/presentation/README.md to learn how to use page includes.

This rule also applies to CSS custom properties. Do not tune a component with an inline `style` attribute. Put the custom-property override in a modifier class, a reusable class, or the page's local stylesheet.

## File Organization

CSS source lives under `src/static-assets/stylesheets/`. There are two stylesheet bundles with a dedicated entrypoint for each one:

- `src/static-assets/stylesheets/admin.css`
- `src/static-assets/stylesheets/stylesheet.css`

```text
src/static-assets/stylesheets/
├── admin.css
├── stylesheet.css
└── lib/             # Source library for admin.css and stylesheet.css
```

Templates link to public logical URLs such as `/stylesheets/stylesheet.css`; source imports use root-relative logical URLs such as `/stylesheets/lib/layout.css`. Keep the bundle ordered from low-level foundations to higher-level components.

Before adding a new file to `lib/`, prefer extending one of the existing files. The project favors a handful of well-documented stylesheets over many small files, so related rules stay close to the examples and comments that explain them.

## CSS Formatting

Use the formatting already present in `src/static-assets/stylesheets/`:

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

BEM in this project is an ownership rule, not just a naming convention:

- **A block owns its internal layout and its elements.** A block never sets its own outside margin — that space belongs to whatever sibling relationship the block sits in (see Flow, below).
- **An element is only ever styled from within its own block's rules.** `.callout__body` is styled in the `.callout` section of `components.css`. No other block's rules may reach into `.callout__body`.
- **A modifier always accompanies its base class in markup** (`class="callout callout--warning"`), never alone. The base class carries the shared rules; the modifier only overrides what varies.
- **Page-local stylesheets may add a new block, a new modifier of an existing block, or a page-scoped rule.** They may not restyle a shared block's elements — that is the shared block's owner reaching an inconsistent hand back into a stylesheet it does not control.
- **Utilities are flat, single-purpose classes**: `.flow`, `.cluster`, `.center`, `.type-caption`. They are not blocks — they have no elements and no modifiers — they are reusable declaration blocks applied directly to whatever markup needs them.

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

The default font stack is a generic system sans-serif (`--font-body`, `--font-display`), with no downloaded font files. Monospace (`--font-mono`) is reserved for `code`, `pre`, `kbd`, and copy-field values — it is not the project's default voice. A downstream site that wants a web font adds it in its own base template and overrides `--font-body` / `--font-display`; it does not edit the shared token file.

There are two generalized categories of typography used in this project:

1. The public website - usually for marketing purposes
2. The admin panel - purely utility

### Typography for the Admin Panel

Do not use color, italics, negative tracking, or decoration to create hierarchy. Hierarchy comes from size, weight, spacing, and structure. Type sizes are fixed `rem` steps from the `--text-*` scale so browser zoom stays predictable (WCAG 1.4.4 Resize Text). This is the default for all app, admin, and reading text — reach for it unless you are building a marketing page.

### Typography for Public Marketing Pages

Public marketing pages (the home page and its kin) may, and are encouraged to, use fluid `clamp()` sizing for the large *display* type that carries the page — a hero title, an oversized background motif, a lede — where the size should track the viewport instead of jumping at a breakpoint. Keep it to that expressive display type: body copy, reading text, and anything in app or admin UI stays on the fixed `--text-*` scale. Put the fluid rules in the page's own `page_stylesheet`, never in the shared token or stylesheet files.

When you do reach for fluid type, keep it zoom-safe so it does not regress WCAG 1.4.4: give `clamp()` a `rem` minimum and a `rem` maximum, and make the preferred (middle) value include a `rem` term — e.g. `clamp(2.75rem, calc(2.125rem + 1.8vw), 3.75rem)`. The `rem` base means browser zoom still scales the text; the `vw` term only adds viewport responsiveness on top. Never use a bare `vw` preferred value: it ignores zoom.

## Layout Primitives

`layout.css` defines a small family of composable, single-purpose layout primitives in the Every Layout tradition. Each is one class tuned by scoped custom properties. Compose these before writing a new `display: flex` or `display: grid` rule. Most page structure should be a nesting of these primitives.

`.cluster`, `.grid-auto`, `.switcher`, and `.with-sidebar` are `gap`-based and exist for two-dimensional or inline arrangement. `.flow` is different on purpose: it owns vertical document rhythm, not a flex column, and is implemented as the "lobotomized owl":

```css
.flow > * + * {
    margin-block-start: var(--flow-space, var(--space-sm));
}
```

- **Spacing is a relationship between siblings, and the parent `.flow` owns it.** Components never set their own vertical margins — that would fight the flow container for the same space.
- **The container tunes the default rhythm** by declaring `--flow-space` on itself; every child inherits it.
- **A child overrides for itself alone** by declaring `--flow-space` on that one child — this changes the space *above that child only*, not the rhythm of its siblings.
- **Nesting is safe** because a nested `.flow` only applies margins to its own direct children; it never reaches into a descendant's descendants.

Do not use `.flow` to build a flex column, and do not set `display: flex` on `.flow`.

When a primitive needs shell-specific defaults, scope those defaults to the shell class. For example, `.site-layout` sets `--sidebar-content-min` for the app shell built on `.with-sidebar`; the primitive itself stays generally reusable.

## Composition

Page structure is layout primitives → blocks → elements, in that order of responsibility:

- A layout primitive (`.flow`, `.cluster`, `.with-sidebar`, …) and a block class (`.card`, `.callout`, …) may coexist on the same element — `<div class="card flow">` is the normal, expected composition.
- A layout class never carries block styling, and a block never lays out its siblings — that is the layout primitive's job.
- A block's *internal* layout may use primitives on its own child elements (for example `<div class="callout__body flow">`), but the block itself does not reimplement `gap` or margin spacing that a primitive already provides.

## When to Add What

| Situation | Where it goes |
| --- | --- |
| A value changes on one instance, structure stays the same | A scoped CSS custom property override, set on that instance |
| A variant of an existing block | A modifier class (`.block--modifier`) in the block's file |
| A reusable declaration block with no parts | A utility class in `layout.css` or `typography.css` |
| A new reusable component with parts | A new block in `components.css` or `forms.css` |
| Styling that belongs to exactly one page | The page's `page_stylesheet` include |
| A new color or size is needed | Check existing tokens first (`design-tokens.css`); add a token only if nothing fits |

## Components and Forms

Reusable components live in `components.css` and `forms.css`. Copy their documented anatomy instead of inventing parallel markup.

Component state should be visible, semantic, and restrained. Buttons invert or shift border color; destructive actions use the danger signal; focus uses `--color-focus-outline`.

The shipped defaults are neutral on purpose: a small border radius, hairline borders, no shadows, a single link accent color. These are defaults, not rules — a downstream site is expected to change them. Change them through tokens first (`--radius-sm`, `--radius-md`, `--control-radius`, the `--color-*` tier), and through a new modifier class second, before reaching for a one-off override.

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

This is the supported pattern for localized styles. Reach for `page_stylesheet` only when the styling is specific to one page and is not worth generalizing into `src/static-assets/stylesheets/lib/`.
