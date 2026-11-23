# ConflictError

HTTP 409. The request conflicts with the current resource state — duplicate unique key, stale `If-Match`, concurrent-edit collision, etc.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 409](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'ConflictError'` |
| `code` | `'CONFLICT_ERROR'` |
| `httpStatusCode` | `409` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { ConflictError } from 'kixx-server-errors';

throw new ConflictError(`A user with email "${ email }" already exists`);
```
