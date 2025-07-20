# UnsupportedMediaTypeError

A 415 Unsupported Media Type error class that indicates the server refuses to accept the request because the payload format is in an unsupported format.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'UnsupportedMediaTypeError' | The name of the error class |
| `code` | 'UNSUPPORTED_MEDIA_TYPE_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 415 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the media type issue |
| `options` | object | Optional configuration object |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 415 | HTTP status code |
| `accept` | string[] | [] | List of accepted content types |
| `acceptEncoding` | string[] | [] | List of accepted encodings |
| `acceptLanguage` | string[] | [] | List of accepted languages |

## Usage

```javascript
import { UnsupportedMediaTypeError } from 'kixx-server-errors';

// Basic usage
throw new UnsupportedMediaTypeError('Unsupported media type', {
    acceptEncoding: ['gzip']
});
```
