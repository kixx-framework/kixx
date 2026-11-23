# ForbiddenError

HTTP 403. The caller is authenticated but not permitted to perform the requested action. Distinct from 401 errors: the server knows who the caller is and is refusing anyway.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 403](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'ForbiddenError'` |
| `code` | `'FORBIDDEN_ERROR'` |
| `httpStatusCode` | `403` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { ForbiddenError } from 'kixx-server-errors';

throw new ForbiddenError('Account lacks "write:documents" scope');
```
