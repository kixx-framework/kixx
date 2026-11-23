# WrappedError

Base class for every error in this library. Extends the native `Error` and adds stable, enumerable metadata (`name`, `code`, `expected`, `httpError`, `httpStatusCode`) used by HTTP handlers and serializers.

Throw `WrappedError` directly when wrapping an unexpected failure — the default `expected: false` signals that upstream callers should treat it as a programmer error.

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'WrappedError'` |
| `code` | `'WRAPPED_ERROR'` |
| `expected` | `false` |
| `httpError` | `false` (no `httpStatusCode` by default) |

## Constructor

```javascript
new WrappedError(message, options?, sourceFunction?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | Passed to `Error`. |
| `options` | object | See options below. |
| `sourceFunction` | function | If provided, stack frames at and above this function are omitted via `Error.captureStackTrace`. |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cause` | Error | — | Standard [`Error: cause`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause). Its `.code` is never copied to `this.code`. |
| `code` | string\|number | static `CODE` | Overrides the error code when it is a non-empty string or a number (including `0`). An empty string is ignored. |
| `name` | string | class name | Overrides the error name. |
| `expected` | boolean | class default (`false` for `WrappedError`) | Overrides whether this is an operational/expected error. |
| `httpStatusCode` | number | — | When set, `httpError` becomes `true`. |

## Example

```javascript
import { WrappedError } from 'kixx-server-errors';

try {
    await doWork();
} catch (cause) {
    throw new WrappedError('doWork failed unexpectedly', { cause });
}
```
