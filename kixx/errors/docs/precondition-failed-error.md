# PreconditionFailedError

HTTP 412. A conditional request header evaluated to false — a stale `If-Match`, a failed `If-Unmodified-Since`, etc. The resource was left unchanged.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 412](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/412).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'PreconditionFailedError'` |
| `code` | `'PRECONDITION_FAILED_ERROR'` |
| `httpStatusCode` | `412` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { PreconditionFailedError } from 'kixx-server-errors';

if (request.headers.get('if-match') !== record.etag) {
    throw new PreconditionFailedError(`Record ${ record.id } has changed`);
}
```
