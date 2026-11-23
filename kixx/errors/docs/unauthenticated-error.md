# UnauthenticatedError

HTTP 401. The request did not present valid authentication credentials (no token, expired session, etc). For credentials that were presented but rejected, use [`UnauthorizedError`](./unauthorized-error.md). For authenticated callers lacking permission, use [`ForbiddenError`](./forbidden-error.md).

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 401](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'UnauthenticatedError'` |
| `code` | `'UNAUTHENTICATED_ERROR'` |
| `httpStatusCode` | `401` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { UnauthenticatedError } from 'kixx-server-errors';

throw new UnauthenticatedError('Authentication required');
```
