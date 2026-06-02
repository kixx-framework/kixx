# Maintaining Code Quality

Be disciplined in your code writing tasks to ensure that you are writing code for future maintainability.

Proactively refactor code to leave it cleaner than when you found it so the codebase is improving in quality as it grows. We want to avoid adding accidental complexity to the codebase as much as we possibly can.

Keep refactoring scoped to the work you are already doing unless the user explicitly asks for broader cleanup.

## Owners of responsibility

When you encounter procedural code, shift your focus from how a task is done to what object, method, or function is responsible for doing it.

- A class is useful when there is durable state, a lifecycle, caching, or an API that benefits from grouping related operations.
- A module is enough when the responsibility needs private helpers but no per-instance state.
- A plain helper function is enough when the behavior is stateless, has no hidden invariants, and can be named precisely.
- Data that carries important invariants should usually be manipulated through the module or object that owns those invariants.
- Think of relationships between data and concepts as objects with their own responsibilities and capabilities.

*Lean into Object Oriented Programming (OOP).* - In this project that means strongly considering the owners of responsibility, *not* the "one class per noun" methodology.

## Use Encapsulation

Encapsulation is also known as "information hiding". The information hidden within a module usually consists of details about how to implement some mechanism which other parts of the system don't need to know about.

Encapsulate your code in two ways:

1. Your interfaces - classes, method signatures, function signatures - should reflect a simpler, more abstract view of the object's functionality and hide the details.
2. There are no dependencies on an object's, method's, or function's internal information from outside it.

In perfect code, each object is completely independent of the others: You could work in any of the objects without knowing anything about any of the other objects except their public interfaces.

## Respect Existing Architecture

Project-specific architecture guidance takes precedence over general code quality guidance. Use this document to improve design within the boundaries described by the relevant project docs.

- Read `docs/index.md` first and then the full documents relevant to the task.
- Keep Worker application code in `src/` compatible with the Cloudflare Workers runtime. Do not use native Node.js modules or filesystem access there.
- Keep app-specific behavior, request handlers, middleware, forms, error handlers, Transaction Scripts, data gateways, and collections under `src/app/` according to `src/app/README.md`.
- Keep presentation-layer behavior, domain workflows, data access, browser scripting, error handling, and tests in the layers described by their dedicated guides.
- Prefer the existing framework, collection, context, route, form, and template patterns before introducing a new architectural shape.

## Separate specialized code from general-purpose code

User interface code should be separated from general purpose domain code:

- Handlers, views, and templates in a web application
- A command line interface or terminal user interface

Low level adapters and drivers should be separated from general purpose domain code:

- Database adapters or mappings
- File system abstractions
- HTTP API clients

## Smaller modules, classes, and methods are not always better

Creating small classes, methods, and functions is NOT your goal when writing or refactoring code; making the code simpler is your goal. There are times when you should bring code together to make it simpler instead of decomposing it.

Bringing pieces of code together when:

- They share information; for example, both pieces of code might depend on information about a common protocol.
- They are used together: anyone using one of the pieces of code is likely to use the other as well.
- They overlap conceptually, in that there is a simple higher-level category that includes both of the pieces of code.
- It is hard to understand one of the pieces of code without looking at the other.

## Avoid thin wrapper classes

Avoid writing classes which are just thin wrappers over some data with getters and setters.

This is bad:

```javascript
class Dog {

    #color;
    #weight;
    #breeds;

    constructor(args) {
        this.#color = args.color;
        this.#weight = args.weight;
        this.#breeds = args.breeds;
    }

    get color() { return this.#color; }

    get weight() {
        return Number.parseFloat(this.#weight);
    }

    get breeds() {
        return this.#breeds.join(', ');
    }
}
```

Don't write useless getters and setters like that. When you see it, either remove them, or remove the whole class if it serves no other purpose. Just operate on the plain JavaScript object, and maybe include a JSDoc @typedef type definition for it.

This is better:

```javascript
class Dog {

    constructor(args) {
        this.color = args.color;
        this.weight = Number.parseFloat(args.weight);
        this.breeds = args.breeds.join(', ');
    }
}
```

Or use a type definition:

```javascript
/**
 * @typedef
 * @property {string} color - The common color of the dog
 * @property {number} weight - The weight of the dog expressed as a float
 * @property {string} breeds - The common breeds of the dog expressed as a comma separated list
 */

/**
 * @returns {Dog}
 */
function createDog(args) {
    return {
        color: args.color,
        weight: Number.parseFloat(args.weight),
        breeds: args.breeds.join(', '),
    };
}
```

## Methods and functions should do one thing

The methods and functions you write should do one thing and only that thing.

A method should change the state of an object, or it should return some information about that object.

In order to make sure our functions are doing one thing, you need to make sure that the statements within your method are all at the same level of abstraction.

## Minimize the number of arguments for methods and functions

Use the fewest number of arguments to a method or function as possible. More than three arguments should be avoided if possible. When a method seems to need more than two or three arguments, it is likely that some of those arguments could become a plain options, configuration, or specification object.

## Name precisely

Constants, classes, methods, and functions should read so that a future reader has no surprises about what they are or do. Prefer nouns for classes that model a thing (`ApplicationConfig`, `SourceBundle`) and verb phrases for classes that perform an action (`WorkerDeployment`, not `WorkerModuleHandler`). If a name needs a comment to explain it, rename instead of commenting.

## Naming Conventions
- **Files**: kebab-case (`user-service.js`, not `UserService.js`)
- **Functions**: camelCase, verb-first (`createUser`, `validateToken`)
- **Classes**: PascalCase with descriptive suffixes (`UserCreateInput`, `AuthResponse`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Boolean variables**: is/has/can prefix (`isActive`, `hasPermission`)
- **Form Data Values**: snake_case (`email_address`, `user_id`), values used in template context
