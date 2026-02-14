Kixx
====
__A rapid web development framework for humans and their AI tools.__

Build blazingly fast in AI environments like Claude Code and Cursor without generating piles of shit code you’ll need to rewrite later. Kixx is designed to build server-rendered, hypermedia-driven applications (HTML as the engine of application state) with minimal client side scripting. It emphasizes productivity, simplicity, and efficiency.

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2026.

Quick Start
-----------
First, know that you'll need to be familiar with accessing and using the command terminal on your machine. Not too scary, but just so you're aware.

Ensure you have Node.js 16.13.2 or later installed. Check your node version in the command terminal with `node --version`. If you don't have it, you can download Node.js from [nodejs.org/download](https://nodejs.org/en/download).

*Installing Node.js will also install npm which is required for the next steps.*

1. Create a new project directory with a `package.json` file in it. You can quickly do this with `npm init`.
2. Install Kixx in your project directory by running `npm install --save kixx`.
3. Set up your project scaffolding by running `npx kixx init-project --name 'My New Web App'`.
4. Start your new web app by running `npx kixx dev-server`
5. Open your browser to http://localhost:3000 to see your app.

Concepts
--------
### Improved AI Control
Use AI for what it's good at and otherwise get it out of the way.

Kixx manages the LLM context from an MCP server, guiding the LLM to use convention and configuration over code to keep AI agents out of trouble. Your AI environment has the information and tools it needs to be helpful, but not so much context to waste time thrashing around.

### Developer Power
Kixx never takes away your power to shoot yourself in the foot.

You'll always have full control over your projects with the ability to extend everything with your own code while directing your AI tools in the background. All conventions and configurations can be overridden, new code can be added, and existing code can be extended.

Core Principles
---------------
The Kixx Framework has a set of core principles which guide all the decisions made in its design and approach to developing web applications.

### 1. Optimize for productivity.
When a design decision needs to be made, Kixx will optimize for developer productivity. This is the north star of the Kixx framework, and most of the remaining principles derive from it.

### 2. Have opinions
Kixx has opinions about building great web applications. A framework needs to bring opinions, otherwise, what's the point of using a framework?

### 3. Software is a craft.
Humans write software for humans. Even in a post AI world, building software will always be a craft done by a craftsperson.

### 4. Remove complexity.
Kixx seeks out and eliminates incidental complexity so developers can use more brain capacity on the real problems we're trying to solve.

### 5. The World Wide Web is the best application platform ever invented.
Nothing has ever been created that matches the accessibility, openness, power, and distribution of the Web. Kixx is fully committed to improving and contributing to the WWW.

### 6. AI tools can be built and used without negative externalities.
AI tools should be small, efficient, productive, and focused on the craft of software development. There is no need to over-consume our natural resources and invade our privacy to use AI effectively in software development.

### 7. Favor monolithic, hypermedia driven applications.
Kixx is for solo developers and small, fast moving teams. Monolithic, hypermedia driven applications give us a massive productivity boost over the complexity of microservices and bloated JavaScript client applications.

### 8. Convention over Configuration and Code
Wherever possible Kixx uses conventions over configuration and code for common web application logic. This dramatically reduces the amount of code that needs to be written, generated, understood, and debugged.

Environment
-----------
Kixx works with Node.js and supports these versions of JavaScript (ECMA) and Node.js:

| Env     | Version    |
|---------|------------|
| ECMA    | >= ES2022  |
| Node.js | >= 16.13.2 |

__Note:__ There is no TypeScript here. There are reasons for that - primarily developer happiness ;-)

Hypermedia-Driven Applications
------------------------------
Hypermedia-Driven Applications are web application where **hypermedia (HTML) serves as the engine of application state**. Instead of relying on JavaScript to manage state and coordinate between client and server, the application state changes by following links and submitting forms embedded in the HTML responses.

1. **Server-side rendering** of all application state
2. **State transitions through hypermedia** (links and forms)
3. **Progressive enhancement** with minimal JavaScript
4. **RESTful architecture** with HTML hypertext as the representation of state
5. **Monolithic design** for simplicity and productivity

The Kixx framework embodies these principles, providing a productive environment for building web apps that are simple, fast, and maintainable.

For more information about hypermedia-driven applications, see:

- [Hypermedia-Driven Applications by HTMX](https://htmx.org/essays/hypermedia-driven-applications/)
- [The Web's Grain by Frank Chimero](https://frankchimero.com/blog/2015/the-webs-grain/)
- [REST: From Research to Practice](https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm)

Kixx Application Developer Documentation
----------------------------------------
You can find developer documentation for building web applications with Kixx at [www.kixx.dev](https://www.kixx.dev). The remaining documentation here is for developers working on the Kixx framework itself.

Kixx Framework Development
--------------------------
Information for developers who want to better understand how Kixx works, need to modify the source code, or want to make contributions to the Kixx framework.

### Project Structure
The Kixx framework project is organized into several top-level directories, each serving a specific purpose in the framework's architecture.

```
kixx/
├── bin/                    # CLI entry point (included in npm package)
├── cli/                    # CLI command implementations (included in npm package)
├── docs/                   # Internal developer documentation (NOT in npm package)
├── lib/                    # Core framework source code (included in npm package)
├── project-template/       # Scaffolding for new projects (included in npm package)
├── test/                   # Test suite mirroring lib/ structure (NOT in npm package)
├── tools/                  # Development tools (NOT in npm package)
├── tmp/                    # Temporary files (git-ignored)
├── reference/              # Reference implementations
├── eslint.config.mjs       # ESLint configuration
├── package.json            # NPM package configuration
└── run-tests.js            # Test runner script
```

For a much more detailed look at the project file organization structure, have a look at the documentation at `docs/project-structure.md`.

### A note about Cursor and Claude Code
Cursor and Claude Code are often used when working on the Kixx framework. So, you'll find helpful artifacts for framework development in `CLAUDE.md` and `.claude/skills/`.

### Coding Conventions and Linting
You can find the coding conventions for this project documented in javascript-coding-conventions skill at `.claude/skills/javascript-coding-conventions/SKILL.md`.

**Run the full lint check:**

```bash
npx eslint ./
```

**Run the linter on a specific directory of source files. The directory will be read recursively.*

```bash
npx eslint lib/application/
```

**Run the linter on a specific file:**

```bash
npx eslint lib/application/request-context.js
```

**Run the linter to fix issues that it finds in a specific file:**

```bash
npx eslint --fix lib/application/request-context.js
```

Note that the eslint linter cannot fix all issues, but may be able to fix many of them faster and easier than you can.

### Running Tests
All test modules are located in the `test/` directory.

**Run all tests:**

```bash
node ./run-tests.js
```

**Run a specific directory of tests (read recursively):**

```bash
node ./run-tests.js test/application/
```

Running a directory of tests can be helpful when working on a specific component or capability of the system.

**Run a specific file of tests:**

```bash
node ./run-tests.js test/application/application-context.test.js
```

Running only a single file of tests can help isolate testing a specific module you're working on.

**Run the linter and full test suite**

```bash
npm test
```

It's good to run the linter and full test suite when your tests are complete to be sure there are no regressions.

### Detailed Kixx Framework Development Documentation

- [Project Structure](docs/project-structure.md)
- [Error Handling](docs/error-handling.md)
- [Assertion Library Reference](docs/assertions-library-reference.md)

Copyright and License
---------------------
Copyright: (c) 2017 - 2026 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
