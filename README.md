Kixx Hypermedia Framework
=========================
Kixx is a web development framework for Node.js servers which is derived from these core principles:

### 1. Optimize for productivity.

### 2. Computer programming is an art and a craft.

### 3. Remove complexity from the framework *and* the applications which are built on it.

### 4. The World Wide Web is our application development and distribution platform of choice.

### 5. Embrace the essence of the Web and optimize for building [Hypermedia Driven Applications](https://htmx.org/essays/hypermedia-driven-applications/).

### 6. Have a bias toward monilithic applications over distributed or microservice architectures.

### 7. Have opinions and make decisions.

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2025.

## Environment Support

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |
| Deno    | >= 1.0.0   |

This library is designed for use in an ES6 module environment requiring __Node.js >= 16.13.2__. It targets at least [ES2022](https://node.green/#ES2022).

If you're curious: Node.js >= 16.13.2 is required for [ES6 module stabilization](https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#modules-ecmascript-modules) and [ES2022 support](https://node.green/#ES2020).

__Note:__ There is no TypeScript here. There are reasons for that: Primarily developer happiness.

## Hypermedia-Driven Applications: A Better Way to Build Web Apps
A hypermedia-driven application is a web application where **hypermedia (HTML) serves as the engine of application state**. Instead of relying on JavaScript to manage state and coordinate between client and server, the application state changes by following links and submitting forms embedded in the HTML responses.

### Core Principles
1. **Server-side rendering** of all application state
2. **State transitions through hypermedia** (links and forms)
3. **Progressive enhancement** with minimal JavaScript
4. **RESTful architecture** with HTML hypertext as the representation of state
5. **Monolithic design** for simplicity and productivity

The Kixx framework embodies these principles, providing a productive environment for building hypermedia-driven applications that are simple, fast, and maintainable.

For more information about hypermedia-driven applications, see:
- [Hypermedia-Driven Applications by HTMX](https://htmx.org/essays/hypermedia-driven-applications/)
- [The Web's Grain by Frank Chimero](https://frankchimero.com/blog/2015/the-webs-grain/)
- [REST: From Research to Practice](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm) 

### Issues with large single page applications:
- Build tooling and bundling
- Large JavaScript bundles (2-5MB+)
- Complex caching strategies
- State synchronization issues
- Memory leaks from long-running apps
- Network failures break the entire app
- Frontend/backend coordination
- API versioning and compatibility
- Complex debugging across client/server
- Multiple deployment pipelines

### Issues with microservice architectures:
- Service discovery and load balancing
- Distributed tracing and monitoring
- Network latency and failure handling
- Data consistency across services
- Complex deployment orchestration
- Cross-service coordination

## Benefits of monolithic hypertext driven applications:
- Minimal build process
- Server handles all routing and navigation
- Simple HTTP caching
- No client-side state management needed
- No memory leaks (stateless requests)
- Natural SEO (server-rendered HTML)
- Simple HTTP error handling
- No state synchronization needed
- Single codebase and deployment
- No API coordination needed
- Simple debugging (server-side only)
- Single deployment unit
- Simple monitoring and debugging
- No network latency between components
- ACID transactions across the entire application
- Single team can work on entire application
- Simple integration testing
- Faster feature development
- Straightforward scaling (scale the whole app)

## When to Choose Hypermedia-Driven Applications

### Ideal Use Cases

✅ **Content-heavy applications** (blogs, news sites, documentation)
✅ **E-commerce platforms** (product catalogs, shopping carts)
✅ **Internal business applications** (CRUD operations, workflows)
✅ **Administrative interfaces** (dashboards, management tools)
✅ **Progressive web applications** (offline-capable, installable)

### When to Consider Alternatives

❌ **Real-time applications** (chat, live collaboration)
❌ **Heavy client-side computation** (data visualization, games)
❌ **Third-party integrations** (complex API ecosystems)


Copyright and License
---------------------
Copyright: (c) 2017 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
