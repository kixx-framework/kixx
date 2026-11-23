# UnauthorizedError

HTTP 401. Credentials were presented but rejected (bad password, invalid token signature, revoked key). For the "no credentials at all" case use [`UnauthenticatedError`](./unauthenticated-error.md); for authenticated-but-not-permitted use [`ForbiddenError`](./forbidden-error.md).

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 401](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'UnauthorizedError'` |
| `code` | `'UNAUTHORIZED_ERROR'` |
| `httpStatusCode` | `401` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { UnauthorizedError } from 'kixx-server-errors';

throw new UnauthorizedError('Invalid credentials');
```
