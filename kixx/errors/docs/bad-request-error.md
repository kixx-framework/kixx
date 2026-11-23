# BadRequestError

HTTP 400. The request is malformed or fails request-shape validation (unparseable body, missing required fields at the envelope level, etc). For per-field validation failures prefer [`ValidationError`](./validation-error.md).

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 400](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'BadRequestError'` |
| `code` | `'BAD_REQUEST_ERROR'` |
| `httpStatusCode` | `400` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { BadRequestError } from 'kixx-server-errors';

throw new BadRequestError('Invalid JSON payload');
```
