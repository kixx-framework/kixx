# MethodNotAllowedError

A 405 Method Not Allowed error class that indicates the HTTP method is not supported for the requested resource.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'MethodNotAllowedError' | The name of the error class |
| `code` | 'METHOD_NOT_ALLOWED_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 405 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the method not allowed |
| `options` | object | Optional configuration object including allowedMethods |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 405 | HTTP status code |
| `allowedMethods` | string[] | [] | List of allowed HTTP methods |

The `allowedMethods` Array will be present on the error instance as `error.allowedMethods`.

## Usage

```javascript
import { MethodNotAllowedError } from './mod.js';

// Basic usage
throw new MethodNotAllowedError('Method not allowed', {
    allowedMethods: ['GET','HEAD']
});
```
