# ServiceUnavailableError

HTTP 503. A backing service is temporarily unable to handle the request — overloaded, in maintenance, or rate limited. Carries `retryAfterSeconds` so the handler can populate the `Retry-After` response header.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 503](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'ServiceUnavailableError'` |
| `code` | `'SERVICE_UNAVAILABLE_ERROR'` |
| `httpStatusCode` | `503` |
| `httpError` | `true` |
| `expected` | `true` |

## Instance members

| Member | Type | Description |
|--------|------|-------------|
| `retryAfterSeconds` | `number\|null` | Seconds a client should wait before retrying, or `null` when unknown. Enumerable and non-writable. |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options) plus the options below. Pass `expected: false` to mark a specific instance as unexpected.

| Option | Type | Description |
|--------|------|-------------|
| `retryAfterSeconds` | `number` | A non-negative integer (including `0`) is kept. Anything else becomes `null`. |

## Example

```javascript
import { ServiceUnavailableError } from 'kixx-server-errors';

throw new ServiceUnavailableError('The store is overloaded', {
    retryAfterSeconds: 30,
});
```
