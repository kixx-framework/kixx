# NotFoundError

HTTP 404. The requested resource does not exist.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 404](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'NotFoundError'` |
| `code` | `'NOT_FOUND_ERROR'` |
| `httpStatusCode` | `404` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { NotFoundError } from 'kixx-server-errors';

throw new NotFoundError(`No user with id "${ id }"`);
```
