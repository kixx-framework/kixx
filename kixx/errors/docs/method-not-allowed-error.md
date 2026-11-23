# MethodNotAllowedError

HTTP 405. The resource exists but does not support the request method. Carries `allowedMethods` so the handler can populate the required `Allow` response header.

Extends [`WrappedError`](./wrapped-error.md). See [MDN: 405](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'MethodNotAllowedError'` |
| `code` | `'METHOD_NOT_ALLOWED_ERROR'` |
| `httpStatusCode` | `405` |
| `httpError` | `true` |
| `expected` | `true` |

## Instance members

| Member | Type | Description |
|--------|------|-------------|
| `allowedMethods` | `ReadonlyArray<string>` | Frozen copy of the methods the resource does support. Empty array if none supplied. |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options) plus the options below. Pass `expected: false` to mark a specific instance as unexpected.

| Option | Type | Description |
|--------|------|-------------|
| `allowedMethods` | `string[]` | Methods to expose via the `allowedMethods` property. Copied and frozen. |

## Example

```javascript
import { MethodNotAllowedError } from 'kixx-server-errors';

throw new MethodNotAllowedError('POST is not supported on this resource', {
    allowedMethods: [ 'GET', 'HEAD' ],
});
```
