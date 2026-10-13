# Cross-Site Request Forgery Protection

This document describes the CSRF threat model and the protection implemented by
the current application. The implementation protects browser HTML forms that
establish authentication or mutate admin state. The Admin and Publishing APIs
use explicit request credentials instead of the browser's admin session cookie
and therefore use a different security model.

## The threat

A page the attacker controls makes a signed-in user's browser send a request to
this site, and the browser attaches this site's cookies. The attacker cannot read
the response, but does not need to if sending the request changes state: creating
or revoking an invite, minting or revoking an API token, or logging the victim
into an attacker-chosen account (login CSRF).

CSRF protection is not a substitute for preventing cross-site scripting (XSS).
A script executing in this site's origin can read form tokens from the DOM and
submit same-origin requests. It also does not protect credentials that have
already been stolen.

## Protection design

The HTML presentation layer uses a stateless synchronizer-token pattern, with
`SameSite` cookies as a second browser-enforced barrier.

### Form rendering

`app/presentation/lib/csrf.js` prepares each protected form through
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
usually keeps both cookies off an attacker's cross-site `POST`, but the signed
form token remains the decisive check rather than trusting every client's
`SameSite` handling.

### Form submission

Every current mutating HTML request handler calls `validateCsrfFormData()` before
constructing its application form or invoking a Transaction Script. Raw-body
file uploads instead call `validateCsrfHeader()`, which reads the token from the
`x-kixx-csrf-token` header without consuming the body. Validation requires:

- A non-empty `kixx_csrf_session` cookie.
- A non-empty submitted `csrf_token` field (or header).
- A well-formed two-segment token.
- A valid HMAC-SHA-256 signature.
- A payload containing a non-empty `sid` and integer expiration.
- An expiration strictly later than the current time.
- A payload `sid` exactly equal to the cookie value.

Malformed, forged, expired, missing, and cookie-mismatched values all fail
closed. The signer returns only `false`, without exposing which cryptographic
check failed. The validator then throws a `ForbiddenError` with code
`InvalidCsrfTokenError`, before submitted data can reach domain logic. Handlers
that can recover catch that code and re-render with a fresh token
(`renderWithFreshCsrf()`) or redirect with a notice; uncaught, it becomes a
generic 403.

An attacker can cause a cross-site submission but cannot read a valid token from
this site's HTML. A guessed token, or one paired with another browser's cookie,
fails the signature or `sid` binding.

### Enforcement is per handler

Protection is explicit in each request handler, not router middleware. A handler
that omits the render helper fails safely, because the validator rejects the
missing token.

- **Every new cookie-authenticated, state-changing HTML route must** render a
  token, validate it before all domain work, and mint a fresh token when
  re-rendering an error.
- **Why not global:** `validateCsrfFormData()` parses the one-shot body once and
  returns the same `FormData` used by application validation, and non-browser
  APIs keep their own authorization model. The cost is review discipline.
- **APIs are exempt** because an ordinary cross-site HTML form cannot meet their
  combined method, authorization-header, and content-type requirements. Revisit
  this if an API starts accepting cookie authentication or simple form requests.

### Token lifecycle

- Each form render mints a fresh 30-minute token and refreshes the cookie's
  30-minute lifetime, but does not extend an older token's embedded expiration.
- Rendering never replaces an existing `sid`, so forms in different tabs stay
  valid independently.
- Validation does not consume tokens; they are reusable until they expire. Form
  handlers remain responsible for business-level idempotency.
- A successful login or signup clears the CSRF cookie after setting the admin
  session cookie. This closes the pre-authentication boundary and invalidates
  tokens bound to the former `sid`.
- Rotating `CSRF_TOKEN_SIGNING_SECRET` invalidates every outstanding form
  immediately.

## Tradeoffs

- **Reusable, browser-wide tokens.** Multiple tabs, reloads, and back-button
  retries work. A per-form or one-time token would narrow the replay window but
  needs server-side state and breaks those navigation patterns. Replay is
  accepted within 30 minutes; the HMAC, expiration, and `sid` binding prevent
  replay with a different or absent CSRF cookie. Copying both the cookie value
  and the token defeats that binding, so their transport and exposure
  protections still matter.
- **Thirty-minute expiration.** Bounds how long an exposed token is useful, at
  the cost of rejecting a submission after 30 minutes of editing.
- **Stateless verification.** No persistence lookup per render or submission and
  no cleanup job, on both Node.js and Cloudflare. The cost is coarse revocation:
  an individual token cannot be invalidated without changing its browser's
  `sid`; rotating the signing secret revokes every user's open form at once.
- **Conditional `Secure`.** Keeps login working on `http://localhost`, but any
  non-local deployment served over HTTP loses transport protection for both CSRF
  and session cookies. **Deployments must terminate requests as HTTPS and
  preserve the correct request protocol.**
