# Cross-Site Request Forgery Protection

This document describes the CSRF threat model and the protection implemented by
the current application. The implementation protects browser HTML forms that
establish authentication or mutate admin state. The Admin and Publishing APIs
use explicit request credentials instead of the browser's admin session cookie
and therefore use a different security model.

## The threat

Cross-site request forgery (CSRF) exploits the browser's automatic handling of
ambient credentials, especially cookies. An attacker first gets a signed-in user
to visit an attacker-controlled page, email, or embedded resource. That content
then causes the user's browser to send a request to the target site. A plain HTML
form can submit across origins, and the browser may attach the target site's
cookies even though the request was initiated elsewhere.

The attacker usually cannot read the response because of the same-origin policy.
Reading it is unnecessary if merely sending the request changes state. Depending
on the available endpoints, a forged request could create or revoke an invite,
mint or revoke an API token, or establish an authentication session chosen by
the attacker. The latter is called login CSRF: subsequent actions may then be
associated with the attacker's account rather than the victim's intended
account.

A CSRF attack requires all of the following:

- The browser supplies a credential without the attacking page knowing it.
- The target accepts a state-changing request the attacker can cause the browser
  to construct.
- The target cannot distinguish the attacker's request from one initiated by its
  own UI.

CSRF protection is not a substitute for preventing cross-site scripting (XSS).
A script executing in this site's origin can read form tokens from the DOM and
submit same-origin requests. It also does not protect credentials that have
already been stolen.

## Protection design

The HTML presentation layer uses a stateless synchronizer-token pattern, with
`SameSite` cookies as a second browser-enforced barrier.

### Form rendering

`src/app/presentation/lib/csrf.js` prepares each protected form through
`getCsrfFormContext()`:

1. It reuses the browser's `kixx_csrf_session` cookie value, or generates a
   cryptographically random `sid` when the cookie is absent.
2. `CsrfTokenSigner` creates an HMAC-SHA-256 token over a JSON payload containing
   that `sid` and an expiration timestamp.
3. The response sets the `sid` cookie and supplies the signed token to the
   template as `form.csrf.token`.
4. The template emits the token in the hidden `csrf_token` form field.

The token has this wire format:

```text
base64url({"sid":"...","exp":...}).base64url(HMAC-SHA-256 signature)
```

The signing key comes from the required `CSRF_TOKEN_SIGNING_SECRET` environment
setting. Application initialization fails if the setting is absent. The raw key
is imported into the Web Crypto API as a non-extractable key, and no server-side
CSRF session record is stored.

The CSRF cookie is set with these attributes:

| Attribute | Value | Effect |
| --- | --- | --- |
| Name | `kixx_csrf_session` | Keeps CSRF state separate from authentication. |
| `Path` | `/` | Lets one browser-wide identifier support every protected form. |
| `Max-Age` | 1,800 seconds | Matches the token lifetime. |
| `HttpOnly` | Yes | Prevents ordinary browser JavaScript from reading the identifier. |
| `SameSite` | `Lax` | Suppresses the cookie on typical cross-site subresource and form `POST` requests. |
| `Secure` | On HTTPS | Prevents transmission over HTTP in deployed HTTPS environments while allowing local HTTP development. |
| `Domain` | Not set | Creates a host-only cookie. |

The admin session cookie also defaults to `HttpOnly; SameSite=Lax`, uses the same
request-dependent `Secure` decision, and is host-only. `SameSite=Lax` therefore
usually prevents both the admin session and CSRF cookie from accompanying an
attacker's cross-site `POST`. The signed form token remains the decisive check
rather than assuming every client implements or preserves `SameSite` correctly.

### Form submission

Every current mutating HTML request handler calls `validateCsrfFormData()` before
constructing its application form or invoking a Transaction Script. Validation
requires:

- A non-empty `kixx_csrf_session` cookie.
- A non-empty submitted `csrf_token` field.
- A well-formed two-segment token.
- A valid HMAC-SHA-256 signature.
- A payload containing a non-empty `sid` and integer expiration.
- An expiration strictly later than the current time.
- A payload `sid` exactly equal to the cookie value.

Malformed, forged, expired, missing, and cookie-mismatched values all fail
closed. The signer returns only `false`, without exposing which cryptographic
check failed. The request handler then throws a `ForbiddenError` with code
`InvalidCsrfTokenError`, before submitted data can reach domain logic.

This blocks a conventional attacker because they can cause a cross-site form
submission but cannot read a valid hidden token from this site's HTML. Guessing a
token or combining a token from one browser with another browser's cookie fails
the signature or `sid` binding.

### Request Handlers

Protection is explicit in each request handler, not automatically applied by
router middleware. A handler that omits the CSRF render helper will fail safely
because its corresponding validator rejects the missing token. However, a new
mutating HTML handler must adopt the helper and validator convention
deliberately.

Non-browser API endpoints do not use the HTML CSRF mechanism because an
ordinary cross-site HTML form cannot meet their combined method,
authorization-header, and content-type requirements. This assumption would
need review if an API begins accepting cookie authentication or
simple form requests.

### Token lifecycle

Each form render mints a fresh token with a 30-minute lifetime and refreshes the
cookie's 30-minute lifetime. Rendering does not replace an existing `sid`, so
forms open in different tabs remain valid independently. Tokens are reusable
until they expire; validation does not consume them. Reuse avoids breaking a
back-button retry or a repeated submission, while normal form handlers remain
responsible for the business-level idempotency of the requested operation.

A successful login or signup clears the CSRF cookie after setting the real admin
session cookie. This closes the pre-authentication boundary and invalidates other
tokens bound to that former `sid`. Rotating `CSRF_TOKEN_SIGNING_SECRET` also
invalidates every outstanding form immediately.

## Security and user-experience tradeoffs

### Reusable, browser-wide tokens

Reusing one browser-wide `sid` and accepting tokens more than once makes multiple
tabs, reloads, and back-button retries work. A per-form identifier or one-time
token would narrow the replay window but would require server-side state and
would make common navigation patterns fail. The chosen design accepts replay
within 30 minutes; the HMAC, expiration, and `sid` binding prevent replay with a
different or absent CSRF cookie. Copying both the cookie value and token would
defeat that binding, so their transport and exposure protections still matter.

### Thirty-minute expiration

The lifetime limits how long an exposed form token remains useful and bounds the
effect of an abandoned form. It also means a user can spend time editing and have
the submission rejected after 30 minutes. Rendering another protected form
refreshes the cookie but does not extend an older token's embedded expiration.

### Stateless verification

Stateless HMAC verification avoids a persistence lookup on every render and
submission, works across the Node.js, Deno and Cloudflare targets, and needs no
cleanup job. The cost is coarse revocation: an individual token cannot be
invalidated without changing its browser's `sid`; rotating the signing secret
revokes every user's open form at once.

### Cookie compatibility

`SameSite=Lax`, `HttpOnly`, host-only scope, and HTTPS-only `Secure` cookies
provide defense in depth without requiring client-side JavaScript. Making
`Secure` conditional keeps login functional on `http://localhost`, but any
non-local deployment served over HTTP loses transport protection for both CSRF
and session cookies. Deployment must therefore terminate requests as HTTPS and
preserve the correct request protocol.

### Explicit rather than global enforcement

Handler-level validation keeps body ownership clear: `validateCsrfFormData()`
parses the one-shot body once and returns the same `FormData` used by application
validation. It also lets non-browser APIs retain their authorization model. The
tradeoff is review discipline. Each new cookie-authenticated state-changing HTML
route must render a token, validate it before all domain work, and mint a fresh
token when re-rendering an error.
