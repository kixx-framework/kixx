# ValidationError

A specialized error class for data validation failures. It extends `WrappedError` and includes additional functionality for handling validation details.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'ValidationError' | The name of the error class |
| `code` | 'VALIDATION_ERROR' | The error code |
| `httpError` | true | Indicates this is an HTTP error |
| `httpStatusCode` | 422 | The HTTP status code |
| `expected` | true | Indicates this is an expected error |
| `length` | 0 | The number of validation objects pushed onto this ValidationError |
| `errors` | Array | validation objects pushed onto this ValidationError |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the validation failure |
| `options` | object | Optional configuration object |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `httpError` | boolean | true | Whether this is an HTTP error |
| `httpStatusCode` | number | 422 | HTTP status code |

## Usage

```javascript
import { ValidationError } from 'kixx-server-errors';

function validateForm(formData) {
    const error = new ValidationError('Invalid form data');

    if (!formData.email || typeof formData.email !== 'string') {
        error.push('Invalid email', 'form.email');
    }
    if (!formData.name || typeof formData.name !== 'string') {
        error.push('Invalid name', 'form.name');
    }

    // If we pushed any validation failures, then throw the error.
    if (error.length > 0) {
        throw error;
    }

    return formData;
}
```
