# Forms Style Guide and Field Error Split

## Implementation Approach

Add a Forms section to the admin style guide that documents whole-form composition instead of introducing a standalone form component: forms are `.flow.field-stack`, fields stay as reusable `.field` blocks, and submit rows use `.cluster`. Update the shared field contract so persistent helper text (`.field__hint`) and validation feedback (`.field__error`) are distinct elements; the wrapper modifier `.field--error` should mark the invalid control, not recolor standing guidance. Migrate the existing live form templates in the same pass so product UI follows the documented contract immediately. Keep the work in existing presentation, template, and stylesheet layers; do not add dependencies, request handlers, or tests.

- [x] **Add the form rhythm token**
  - **Story**: Document and standardize form composition
  - **What**: Add a shared `--form-field-gap` token near `--measure-form` and the spacing scale so form field rhythm can be tuned in one place. Use a value that matches the referenced style guide's intent: roomier than default `.flow`, but still inside the system's measured, utilitarian rhythm.
  - **Where**: `src/stylesheets/lib/design-tokens.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`; `src/stylesheets/lib/design-tokens.css`; referenced form guide at `/Users/kris/Projects/kdevelopment/platform/application/pages/admin/style-guide/forms/`
  - **Acceptance criteria**: AC1, AC2
  - **Depends on**: none

- [x] **Update the shared field and form CSS contract**
  - **Story**: Split helper text from error text
  - **What**: Add `.field-stack` as a flow modifier that binds `--flow-space` to `--form-field-gap`. Add `.field__error` with caption sizing and danger color, update the file comments/anatomy to include both hint and error text, and remove the rule that turns `.field__hint` red under `.field--error`. Keep `.field--error` responsible for the input border and readonly override only.
  - **Where**: `src/stylesheets/lib/forms.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`; referenced form guide at `/Users/kris/Projects/kdevelopment/platform/application/pages/admin/style-guide/forms/body.html`; existing `src/stylesheets/lib/forms.css`
  - **Acceptance criteria**: AC1, AC2, AC3
  - **Depends on**: Add the form rhythm token

- [x] **Add the Forms style-guide page data and local CSS**
  - **Story**: Add Forms to the style guide
  - **What**: Create page metadata for `/admin/style-guide/forms` and a page-local stylesheet for demo-only layout rules. Use the existing `page_stylesheet` include pattern and keep local CSS limited to forms-page demo layout, such as grid track tuning and capping the live anatomy form inside the demo stage.
  - **Where**: `src/pages/admin/style-guide/forms/page.json`; `src/pages/admin/style-guide/forms/page.css`
  - **Documentation**: `src/docs/frontend-development-guide.md`; `src/app/presentation/README.md`; existing style-guide page data under `src/pages/admin/style-guide/*/page.json`; referenced `page.json` and `page.css`
  - **Acceptance criteria**: AC4
  - **Depends on**: Update the shared field and form CSS contract

- [x] **Write the Forms style-guide content**
  - **Story**: Add Forms to the style guide
  - **What**: Add the Forms page body covering anatomy, field rhythm, hints vs. errors, standalone form pages, usage markup, accessibility, and guidelines. Adapt the referenced page to this repo's current class names (`admin-content-section__header`, existing style-guide links, hard-corner aesthetic, current form measure) and include examples that show `.field__hint` and `.field__error` together.
  - **Where**: `src/pages/admin/style-guide/forms/body.html`
  - **Documentation**: `src/templates/README.md`; `src/docs/frontend-development-guide.md`; `src/pages/admin/style-guide/text-fields/body.html`; `src/pages/admin/style-guide/multi-line-text-areas/body.html`; referenced `body.html`
  - **Acceptance criteria**: AC4, AC5, AC6
  - **Depends on**: Add the Forms style-guide page data and local CSS

- [x] **Add Forms to the style-guide navigation**
  - **Story**: Add Forms to the style guide
  - **What**: Add a navigation link for `/admin/style-guide/forms` in the Components section and wire its `aria-current` state using the same `ifEqual` pattern as the existing links.
  - **Where**: `src/templates/pages/admin/style-guide/style-guide-wrapper.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; existing style-guide wrapper template
  - **Acceptance criteria**: AC4
  - **Depends on**: Write the Forms style-guide content

- [x] **Update the Text Fields style-guide examples**
  - **Story**: Split helper text from error text
  - **What**: Update text field prose, anatomy, variants, states, usage snippets, accessibility notes, and guidelines so helper text remains `.field__hint` and validation text uses `.field__error`. Where an invalid example has persistent guidance, render both elements and wire both ids through `aria-describedby`; where there is no persistent guidance, render only `.field__error`.
  - **Where**: `src/pages/admin/style-guide/text-fields/body.html`
  - **Documentation**: `src/templates/README.md`; `src/docs/frontend-development-guide.md`; `src/stylesheets/lib/forms.css`; new Forms style-guide content
  - **Acceptance criteria**: AC2, AC3, AC5
  - **Depends on**: Update the shared field and form CSS contract

- [x] **Update the Text Areas style-guide examples**
  - **Story**: Split helper text from error text
  - **What**: Update text area prose, anatomy, variants, states, usage snippets, accessibility notes, and guidelines to inherit the new field contract: `.field__hint` is persistent guidance and `.field__error` is validation feedback. Keep text-area-specific guidance limited to multi-line behavior, rows, and vertical resize.
  - **Where**: `src/pages/admin/style-guide/multi-line-text-areas/body.html`
  - **Documentation**: `src/templates/README.md`; `src/docs/frontend-development-guide.md`; `src/stylesheets/lib/forms.css`; `src/pages/admin/style-guide/text-fields/body.html`
  - **Acceptance criteria**: AC2, AC3, AC5
  - **Depends on**: Update the Text Fields style-guide examples

- [x] **Migrate the admin login form template**
  - **Story**: Migrate live forms to the helper/error split
  - **What**: Change the login `<form>` to `class="flow field-stack"`. For email and password fields, keep persistent hints in `.field__hint`, add conditional `.field__error` paragraphs for validation failures with `role="alert"`, and make `aria-describedby` include the hint id plus the error id only when an error exists. Preserve the server-side-only validation behavior and the existing comments about not echoing passwords.
  - **Where**: `src/templates/pages/login/admin/new/page.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; new Forms style-guide content
  - **Acceptance criteria**: AC3, AC7
  - **Depends on**: Update the shared field and form CSS contract

- [x] **Migrate the admin signup form template**
  - **Story**: Migrate live forms to the helper/error split
  - **What**: Change the invite-backed signup `<form>` to `class="flow field-stack"`. For email and password fields, render persistent hints separately from conditional `.field__error` paragraphs, add `role="alert"` to field errors, and update `aria-describedby` so assistive technology receives both hint and error text when both are present. Preserve invite-token posting, throttling messages, existing form-level callouts, and password non-echo behavior.
  - **Where**: `src/templates/pages/users/admin/new/page.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; new Forms style-guide content
  - **Acceptance criteria**: AC3, AC7
  - **Depends on**: Migrate the admin login form template

- [x] **Migrate the Publishing API token create form template**
  - **Story**: Migrate live forms to the helper/error split
  - **What**: Change the token create `<form>` to `class="flow field-stack"`. For the description field, render the persistent hint and conditional `.field__error` separately and wire both ids into `aria-describedby` when invalid. For the TTL select, add the same field-error pattern, including `aria-invalid` and `aria-describedby` when an error exists, without changing option rendering, reveal-once token display, revoke forms, or list markup.
  - **Where**: `src/templates/pages/admin/publishing-api-tokens/page.html`
  - **Documentation**: `src/templates/README.md`; `src/app/presentation/README.md`; `src/docs/frontend-development-guide.md`; new Forms style-guide content; `src/pages/admin/style-guide/copy-fields/body.html`
  - **Acceptance criteria**: AC3, AC7
  - **Depends on**: Migrate the admin signup form template

- [x] **Verify rendered style-guide and live form markup**
  - **Story**: Add Forms to the style guide; Migrate live forms to the helper/error split
  - **What**: Run the development server and inspect `/admin/style-guide/forms`, `/admin/style-guide/text-fields`, `/admin/style-guide/multi-line-text-areas`, and the migrated live form pages or their `.json` contexts where authentication/state blocks direct browser access. Check desktop and narrow widths for non-overlapping text, stable form spacing, muted helper text, red error text, and correct `aria-describedby` output. Do not run unit tests unless the user explicitly asks.
  - **Where**: `node tools/devserver.js --config src/node-config.json --port 2026`; relevant URLs under `/admin/style-guide/*`, `/login/admin/new`, `/users/admin/new`, `/admin/publishing-api-tokens`
  - **Documentation**: Development Server instructions in `AGENTS.md`; `src/docs/frontend-development-guide.md`; `src/app/presentation/README.md`
  - **Acceptance criteria**: AC4, AC5, AC6, AC7
  - **Depends on**: Add Forms to the style-guide navigation; Update the Text Areas style-guide examples; Migrate the Publishing API token create form template

- [x] **Run applicable lint checks**
  - **Story**: Implementation hygiene
  - **What**: Run `node run-linter.js` on changed JavaScript source files if the implementation touches any JavaScript. If the change remains limited to HTML templates and CSS, note that there were no JavaScript files to lint. Do not run unit tests unless the user explicitly asks.
  - **Where**: `node run-linter.js [pathname ...]`
  - **Documentation**: Linting instructions in `AGENTS.md`; `src/docs/code-style-guide.md` if any JavaScript is edited
  - **Acceptance criteria**: AC8
  - **Depends on**: Verify rendered style-guide and live form markup

## Acceptance Criteria

AC1. Form field spacing is controlled by a shared token and a reusable `.field-stack` flow modifier.

AC2. `.field__hint` remains muted helper text even inside `.field--error`, while `.field__error` carries validation styling.

AC3. Invalid fields use `.field--error`, `aria-invalid="true"`, conditional `.field__error` text, and `aria-describedby` references that include every rendered helper/error message.

AC4. `/admin/style-guide/forms` renders through the existing admin style-guide shell, appears in navigation, and uses page-local CSS only for demo-specific layout.

AC5. The Text Fields and Multi-Line Text Areas style-guide pages no longer document hints as the error-message slot.

AC6. The Forms style-guide page documents form anatomy, field rhythm, helper/error separation, standalone form columns, usage, accessibility, and do/don't guidance.

AC7. The admin login, admin signup, and Publishing API token create forms use `.flow.field-stack` and render live validation feedback with the new helper/error split.

AC8. No dependencies are installed, no tests are added or run without explicit user request, and applicable linting is run or clearly marked not applicable.
