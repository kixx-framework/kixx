# ForbiddenError

An error class which represents an HTTP 400 Bad Request which indicates the server understood the request but refuses to authorize it.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'ForbiddenError' | The name of the error class |
| `code` | 'FORBIDDEN_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 403 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing why access is forbidden |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 403 | The HTTP status code |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |

## Usage

```javascript
import { ForbiddenError } from 'kixx-server-errors';

// Basic usage
throw new ForbiddenError('Access denied');
```

## Best Practices

1. Use descriptive error messages that explain why access is forbidden
2. Include details about required permissions when possible
3. Set `expected` to `false` for unexpected permission issues
4. Include the original error when wrapping other errors
5. Use the source function parameter to help with debugging
6. Consider providing guidance on how to obtain necessary permissions 