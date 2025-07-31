# ConflictError

An error class which represents an HTTP 409 Conflict.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'ConflictError' | The name of the error class |
| `code` | 'CONFLICT_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 409 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the conflict |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 409 | The HTTP status code |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |

## Usage

```javascript
import { ConflictError } from 'kixx-server-errors';

// Basic usage
throw new ConflictError('Resource already exists');
```
