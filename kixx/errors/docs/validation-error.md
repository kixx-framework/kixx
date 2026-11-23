# ValidationError

Aggregates one or more validation failures into a single thrown error. Typical pattern: construct one, push each failure with a message and a source path, then throw if any accumulated.

Extends [`WrappedError`](./wrapped-error.md).

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'ValidationError'` |
| `code` | `'VALIDATION_ERROR'` |
| `httpStatusCode` | `422` |
| `httpError` | `true` |
| `expected` | `true` |

## Instance members

| Member | Type | Description |
|--------|------|-------------|
| `errors` | `Array<{ message: string, source: string }>` | Collected failure entries. |
| `length` | number | Count of entries in `errors`. |
| `push(message, source)` | method | Appends `{ message, source }` to `errors`. |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). Pass `expected: false` to mark a specific instance as unexpected. No additional options.

## Example

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

    if (error.length > 0) {
        throw error;
    }
    return formData;
}
```
