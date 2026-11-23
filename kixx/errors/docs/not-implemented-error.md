# NotImplementedError

HTTP 501. The server does not support the functionality required to fulfill the request — typically a method the server does not recognize, or a feature flagged as not yet built.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 501](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/501).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'NotImplementedError'` |
| `code` | `'NOT_IMPLEMENTED_ERROR'` |
| `httpStatusCode` | `501` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { NotImplementedError } from 'kixx-server-errors';

throw new NotImplementedError('PATCH is not implemented for this resource');
```
