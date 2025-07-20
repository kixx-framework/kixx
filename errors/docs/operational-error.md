# OperationalError

A base error class for expectd operational errors that can be handled by the application.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'OperationalError' | The name of the error class |
| `code` | 'OPERATIONAL_ERROR' | The error code |
| `httpError` | false | Indicates this is not an HTTP error |
| `expected` | true | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the operational error |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | true | Whether the error was expected |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `httpError` | boolean | false | Whether this is an HTTP error |

## Usage

```javascript
import { OperationalError } from './mod.js';

// Basic usage
throw new OperationalError('Operation failed');
```
