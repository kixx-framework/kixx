End-to-End Test Include
=======================

A page include is a content file owned by one page pathname and referenced from
that page's `page.json` `includes` map, which names it by filename — see
HyperviewService.getIncludes(). Markdown is the shape includes actually take in
this application (`body.md`, `summary.md`), which is also why the include
endpoint accepts any `text/*` media type rather than `text/plain` alone.

Deliberately plain Markdown with no template expressions in it. An include is
only rendered as a template when its metadata declaration sets `template: true`,
and nothing here publishes the page metadata that would do so.
