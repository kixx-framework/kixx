# UnsupportedMediaTypeError

HTTP 415. The request payload's `Content-Type` / `Content-Encoding` / `Content-Language` is not one the server will accept. Carries the supported values so the handler can surface them in the response body.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 415](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/415).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'UnsupportedMediaTypeError'` |
| `code` | `'UNSUPPORTED_MEDIA_TYPE_ERROR'` |
| `httpStatusCode` | `415` |
| `httpError` | `true` |
| `expected` | `true` |

## Instance members

Each of these is a frozen copy of the corresponding option, or an empty frozen array if not supplied.

| Member | Type | Description |
|--------|------|-------------|
| `accept` | `ReadonlyArray<string>` | Media types the server will accept on request bodies. |
| `acceptEncoding` | `ReadonlyArray<string>` | Encodings the server will accept on request bodies. |
| `acceptLanguage` | `ReadonlyArray<string>` | Languages the server will accept on request bodies. |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options) plus the options below. Pass `expected: false` to mark a specific instance as unexpected.

| Option | Type | Description |
|--------|------|-------------|
| `accept` | `string[]` | Acceptable request media types. |
| `acceptEncoding` | `string[]` | Acceptable request encodings. |
| `acceptLanguage` | `string[]` | Acceptable request languages. |

## Example

```javascript
import { UnsupportedMediaTypeError } from 'kixx-server-errors';

throw new UnsupportedMediaTypeError('Request body must be JSON', {
    accept: [ 'application/json' ],
});
```
