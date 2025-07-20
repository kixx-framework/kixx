# UnauthorizedError

A 401 Unauthorized error class that indicates the request was understood but refused due to insufficient permissions.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'UnauthorizedError' | The name of the error class |
| `code` | 'UNAUTHORIZED_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 401 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the authorization failure |
| `options` | object | Optional configuration object including |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 401 | HTTP status code |

## Usage

```javascript
import { UnauthorizedError } from 'kixx-server-errors';

// Basic usage
throw new UnauthorizedError('Insufficient permissions');
```
