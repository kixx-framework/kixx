# AssertionError

A base error class for assertion failures that occur when a condition is not met.

## Properties

Inherits all properties from `WrappedError` with the following defaults:

| Property | Value | Description |
|----------|-------|-------------|
| `name` | 'AssertionError' | The name of the error class |
| `code` | 'ASSERTION_ERROR' | The error code |
| `httpError` | false | Indicates this is not an HTTP error |
| `expected` | false | Indicates this is an expected error |

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | The error message describing the assertion failure |
| `options` | object | Optional configuration object including [cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |
| `sourceFunction` | function | Optional function where the error occurred |

### Options Object

Inherits all options from `WrappedError` with the following defaults:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `expected` | boolean | false | Whether the error was expected |
| `httpError` | boolean | false | Whether this is an HTTP error |
| `cause` | Error | null | The underlying error cause. See [MDN Error:cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause) |

## Usage

```javascript
import { AssertionError } from 'kixx-server-errors';

async function saveJSONDocument(name, doc) {
    if (!doc?.id) {
        throw new AssertionError('A document must have an "id"');
    }

    const filepath = path.join(directory, name);
    const json = JSON.stringify(doc);
    await fsp.writeFile(filepath, json, { encoding: 'utf8' });
}
```
