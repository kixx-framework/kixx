# NotAcceptableError

A 406 Not Acceptable error class that indicates the server cannot produce a response matching the list of acceptable values.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'NotAcceptableError' | The name of the error class |
| `code` | 'NOT_ACCEPTABLE_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 406 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing why the response is not acceptable |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 406 | HTTP status code |
| `accept` | string[] | [] | List of accepted content types |
| `acceptEncoding` | string[] | [] | List of accepted encodings |
| `acceptLanguage` | string[] | [] | List of accepted languages |

## Usage

```javascript
import { NotAcceptableError } from 'kixx-server-errors';

throw new NotAcceptableError('Content type not supported', {
    acceptedTypes: ['application/json', 'application/xml']
});
```
