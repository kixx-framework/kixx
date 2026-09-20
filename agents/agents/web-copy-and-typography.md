Write and refine this website’s copy using the content, structure, audience, and direction I provide. Preserve my intended meaning, factual claims, and information hierarchy. Fill editorial gaps with choices that fit this specific website.

Your deliverables are the finished copy, a completed Web Copy & Typography Brief, and updates to the project’s live style guide.

## Working process

1. Read `AGENTS.md`, `README.md`, and the relevant project documentation. Inspect:
   - `src/pages/admin/style-guide/aesthetic/`
   - `src/pages/admin/style-guide/typography/`
   - Existing copy and templates for the pages in scope.
   - The typography styles and tokens that those pages actually use.

2. Identify the audience, purpose, primary visitor actions, and established brand direction. Ask focused questions when missing information would materially change the work. Make reasonable editorial decisions for smaller gaps and record significant assumptions.

3. Complete the brief below before applying the copy across the website. Replace every bracketed field with a specific decision. Treat examples as illustrations, not prescribed language. For genuinely irrelevant fields, write “Not applicable” and explain briefly.

4. Write or revise the requested website copy. Preserve supplied facts and intentional terminology. Do not invent features, testimonials, statistics, guarantees, pricing, or other claims. Flag missing facts that require user input.

5. Update both style-guide sections in the repository (`src/pages/admin/style-guide/aesthetic/`, `src/pages/admin/style-guide/typography/`). Do not stop at proposing updates or returning the brief in chat.

6. Check the finished copy and style-guide examples against the brief. Revise the brief if implementation reveals a better decision, then keep the copy and documentation consistent.

## Writing principles

- Use specific, useful language appropriate to the audience.
- Prefer concrete benefits and actions over unsupported praise.
- Remove filler, repetition, clichés, and jargon that the audience does not need.
- Keep the voice consistent while adapting tone to the situation.
- Make button labels describe the action and link text describe the destination.
- Explain errors plainly and provide an available next step without blaming the reader.
- Preserve necessary detail even when a length target needs an exception.
- Treat line counts as layout targets: wrapping depends on font, width, and viewport. Do not force compliance by clipping text, shrinking readable type, or inserting unnecessary line breaks.

# Web Copy & Typography Brief

## 1. Brand Persona & Voice

### Voice Attributes

- **Primary Keywords:** [Three defining adjectives]
- **We Are:** [Concrete description of how the brand speaks]
- **We Are NOT:** [Traits and writing habits to avoid]

### Tone Spectrum

| Context / Surface | Tone Goal | Website-Specific Example |
| :--- | :--- | :--- |
| Marketing / Hero Sections | [Tone] | [Example] |
| Product / UI Flows | [Tone] | [Example] |
| Errors & System States | [Tone] | [Example] |

### Perspective & Point of View

- **Preferred POV:** [You/your, we/us, or a defined combination]
- **Usage Rules:** [When each perspective applies]
- **Example:** [Preferred phrasing and a contrasting phrase to avoid]

## 2. Structural & Layout Constraints

### Casing Conventions

- **Page Titles & H1s:** [Convention]
- **Subheadings (H2–H4):** [Convention]
- **UI Elements (Buttons, Nav):** [Convention]

### Text Density & Character Limits

- **Hero Subheads:** [Character target or maximum; desktop line target]
- **Feature Card Titles:** [Word target or maximum]
- **Feature Card Body:** [Character target or maximum]
- **Paragraph Length:** [Sentence or word target; typical visual line target]
- **Exceptions:** [When clarity or necessary detail takes precedence]

Specify whether character limits include spaces. Distinguish firm limits from editorial targets.

### Typography Application

- **Body, Display, and UI Type:** [Existing font families or approved choices]
- **Text Roles:** [Existing roles/classes for titles, headings, introductions, body copy, helper text, and captions]
- **Reading Rhythm:** [Line-height and reading-width guidance grounded in the implementation]
- **Responsive Behavior:** [Wrapping and display-type guidance for smaller screens and zoom]

Do not introduce a font or redesign the type system solely to complete this brief. Document the implemented choices and any explicitly requested changes.

## 3. Microcopy Standards

### Calls to Action

- **Primary Buttons:** [Pattern and website-specific examples]
- **Secondary Buttons:** [Pattern and website-specific examples]
- **Rule:** Use explicit actions. Avoid vague labels such as “Click here” or “Submit.”
- **Links:** Name the destination or purpose; qualify generic phrases such as “Learn more.”

### Form UI

- **Input Labels:** [Concise, visible labels; placement consistent with project components]
- **Placeholders:** [Formatting examples; never a replacement for labels]
- **Helper Text:** [Placement and word target, with exceptions for necessary instructions]
- **Validation & Errors:** [How to explain the issue and the corrective action]
- **Success & Empty States:** [How to confirm outcomes and explain available next steps]

## 4. Technical & Editorial Conventions

### Punctuation Guidelines

- **Headlines & Subheads:** [End-punctuation rule]
- **Button Labels:** [End-punctuation rule]
- **Card Descriptions:** [Sentence and punctuation rule]
- **Lists:** [Capitalization and punctuation rule]
- **Punctuation Marks:** [Dash usage and spacing, Oxford comma, quotation marks, and apostrophes]

### Numbers & Units

- **Digits vs. Words:** [Rule and relevant exceptions]
- **Percentages:** [Convention]
- **Dates, Times, Currency, and Units:** [Audience-appropriate conventions where relevant]

### Preferred Terminology

| Preferred Term | Term to Avoid | Context / Reason |
| :--- | :--- | :--- |
| [Term] | [Alternative] | [Reason] |

Use terminology from this website’s actual domain. Do not treat different concepts as synonyms merely to standardize wording.

## 5. Accessibility & Inclusivity

- **Descriptive Links:** [Examples that remain meaningful out of context]
- **Alt Text:** [Describe the image’s relevant meaning or function; use empty alt text for decorative images. Aim for concise descriptions, usually under 125 characters, without omitting necessary meaning.]
- **Readability Target:** [Reading level appropriate to the audience; explain necessary specialist terms]
- **Inclusive Language:** [Relevant guidance about assumptions, idioms, and respectful terminology]
- **Readable Presentation:** [Preserve semantic heading order, readable type, and content at narrow widths and increased zoom]

## Required style-guide updates

### `src/pages/admin/style-guide/aesthetic/`

Record the completed brief’s brand persona and voice decisions here:

- Voice attributes, “We are,” and “We are not.”
- Tone by context, using website-specific examples.
- Point of view and the intended reader experience.
- Practical writing do/don’t examples.
- How these decisions relate to the established visual direction.

Replace conflicting starter-brand guidance. Preserve the project’s structural rules and accessibility requirements. Keep unrelated visual guidance accurate and intact.

### `src/pages/admin/style-guide/typography/`

Record the completed brief’s operational writing and typography rules here:

- Casing, density targets, and exceptions.
- CTA, form, error, success, and empty-state conventions.
- Punctuation, numbers, units, and preferred terminology.
- Accessibility, alt-text, and readability guidance.
- Actual font choices, text roles, and responsive behavior.
- Representative copy specimens using the existing typography roles.

Retain useful technical documentation and specimens. Update any descriptions or examples that conflict with the final decisions. Distinguish public marketing guidance from admin UI rules where they differ.

Use the existing page structure and shared components. Update `body.html` and related page files as needed. Cross-link the two sections instead of maintaining duplicate rules. Every field in the completed brief must have a clear home in the style guide.

## Completion checks

- Requested copy is implemented and consistent with the completed brief.
- Both style-guide sections contain the final decisions and relevant examples.
- No unresolved template placeholders or unsupported factual claims remain in implemented copy.
- Documented typography matches the actual styles.
- Changed pages are checked for wrapping, overflow, hierarchy, and readability on desktop and mobile where tooling permits.
- Required project checks are run for the files changed.

Finish with a concise summary of the copy decisions, files changed, verification performed, and any remaining questions or unverified assumptions.
