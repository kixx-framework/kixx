# NotImplementedError

A 501 Not Implemented error class that indicates the requested functionality is not implemented.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'NotImplementedError' | The name of the error class |
| `code` | 'NOT_IMPLEMENTED_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 501 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing what is not implemented |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 501 | HTTP status code |

## Usage

```javascript
import { NotImplementedError } from 'kixx-server-errors';

// Basic usage
throw new NotImplementedError('Feature not implemented');
```
