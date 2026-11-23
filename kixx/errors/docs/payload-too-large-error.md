# PayloadTooLargeError

HTTP 413. The request body is larger than the server is willing to accept.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 413](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/413).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'PayloadTooLargeError'` |
| `code` | `'PAYLOAD_TOO_LARGE_ERROR'` |
| `httpStatusCode` | `413` |
| `httpError` | `true` |
| `expected` | `true` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { PayloadTooLargeError } from 'kixx-server-errors';

if (byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError(`Upload exceeds ${ MAX_UPLOAD_BYTES } bytes`);
}
```
