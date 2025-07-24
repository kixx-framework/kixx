# A Kixx Reference Application
A reference web application demonstrating how to use the Kixx framework to build a [hypermedia driven](https://htmx.org/essays/hypermedia-driven-applications/) web application.

## Coding Style

### Use spaces in template literals
Use single space padding inside curly brackets in JavaScript template literals.

__Wrong:__
```javascript
const message = `hello ${person}`;
```

__Correct:__
```javascript
const message = `hello ${ person }`;
```

### EOL Last
All files require a newline at the end fo the file.

### Comma dangle
Always use comma dangle syntax for multiline objects and arrays, but never for imports, or function arguments.

__Wrong:__
```javascript
const obj = {
    'foo': true,
    'bar': false
};

const list = [
    'foo',
    'bar'
];
```

__Correct:__
```javascript
const obj = {
    'foo': true,
    'bar': false,
};

const list = [
    'foo',
    'bar',
];
```


