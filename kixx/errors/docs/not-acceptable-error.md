# NotAcceptableError

HTTP 406. No response representation matches the client's `Accept`, `Accept-Encoding`, or `Accept-Language` headers. Carries the server's supported values so the handler can surface them in the response body.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: content negotiation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'NotAcceptableError'` |
| `code` | `'NOT_ACCEPTABLE_ERROR'` |
| `httpStatusCode` | `406` |
| `httpError` | `true` |
| `expected` | `true` |

## Instance members

Each of these is a frozen copy of the corresponding option, or an empty frozen array if not supplied.

| Member | Type | Description |
|--------|------|-------------|
| `accept` | `ReadonlyArray<string>` | Media types the server can produce. |
| `acceptEncoding` | `ReadonlyArray<string>` | Encodings the server can produce. |
| `acceptLanguage` | `ReadonlyArray<string>` | Languages the server can produce. |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options) plus the options below. Pass `expected: false` to mark a specific instance as unexpected.

| Option | Type | Description |
|--------|------|-------------|
| `accept` | `string[]` | Producible media types. |
| `acceptEncoding` | `string[]` | Producible encodings. |
| `acceptLanguage` | `string[]` | Producible languages. |

## Example

```javascript
import { NotAcceptableError } from 'kixx-server-errors';

throw new NotAcceptableError('Cannot satisfy Accept header', {
    accept: [ 'application/json', 'application/xml' ],
});
```
