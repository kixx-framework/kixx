# WrappedError

The base class for all error classes in the library. It extends the native `Error` class and provides additional functionality for error handling and debugging.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | The name of the error class |
| `code` | string | A unique error code string |
| `message` | string | The error message |
| `expected` | boolean | Indicates if the error was expected (default: true) |
| `httpError` | boolean | Indicates if this is an HTTP error |
| `httpStatusCode` | number | The HTTP status code (for HTTP errors) |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | string | Class name | Custom error name |
| `code` | string | Class code | Custom error code |
| `expected` | boolean | true | Whether the error was expected |
| `httpError` | boolean | false | Whether this is an HTTP error |
| `httpStatusCode` | number | undefined | HTTP status code |
