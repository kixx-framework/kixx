# TooManyRequestsError

HTTP 429. The client has sent too many requests in a given amount of time and is being rate limited. Carries `retryAfterSeconds` so the handler can populate the `Retry-After` response header.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 429](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'TooManyRequestsError'` |
| `code` | `'TOO_MANY_REQUESTS_ERROR'` |
| `httpStatusCode` | `429` |
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
import { TooManyRequestsError } from 'kixx-server-errors';

throw new TooManyRequestsError('Too many failed sign-in attempts', {
    retryAfterSeconds: 600,
});
```
