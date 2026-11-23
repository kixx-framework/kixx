# AssertionError

Thrown when an internal invariant is violated. Treat this as a programmer error — it means the code reached a state it was written to forbid.

Extends [`WrappedError`](./wrapped-error.md). `expected` defaults to `false`; under a process restarter the recommended response is to crash.

## Defaults

| Property | Value |
|----------|-------|
| `name` | `'AssertionError'` |
| `code` | `'ASSERTION_ERROR'` |
| `expected` | `false` |
| `httpError` | `false` |

## Options

Accepts all [`WrappedError` options](./wrapped-error.md#options). No additional options.

## Example

```javascript
import { AssertionError } from 'kixx-server-errors';

async function saveJSONDocument(name, doc) {
    if (!doc?.id) {
        throw new AssertionError('A document must have an "id"');
    }
    const filepath = path.join(directory, name);
    await fsp.writeFile(filepath, JSON.stringify(doc), { encoding: 'utf8' });
}
```
