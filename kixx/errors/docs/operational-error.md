# OperationalError

Base class for expected runtime failures — I/O errors, integration issues, remote service failures — that a correctly-written program should handle rather than crash on.

Extends [`WrappedError`](./wrapped-error.md). Sets `expected: true` by default. Carries no HTTP status; use an HTTP error class for request-handler responses.

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'OperationalError'` |
| `code` | `'OPERATIONAL_ERROR'` |
| `expected` | `true` |
| `httpError` | `false` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

```javascript
import { OperationalError } from 'kixx-server-errors';

try {
    return await fsp.readFile(filepath, { encoding: 'utf8' });
} catch (cause) {
    if (cause.code === 'ENOENT') {
        throw new OperationalError(
            `File does not exist at ${ filepath }`,
            { code: 'FILE_NOT_FOUND', cause }
        );
    }
    throw cause;
}
```
