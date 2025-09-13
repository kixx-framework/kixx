Kixx
====
__A rapid web development framework for humans and their AI tools.__

Build blazingly fast in AI environments like Claude Code and Cursor without generating piles of shit code you’ll need to rewrite later.

Created by [Kris Walker](https://www.kriswalker.me) 2017 - 2025.

Quick Start
-----------
First, know that you'll need to be familiar with accessing and using the command terminal on your machine. Not too scary, but just so you're aware.

Ensure you have Node.js 16.13.2 or later installed. Check your node version in the command terminal with `node --version`. If you don't have it, you can download Node.js from [nodejs.org/download](https://nodejs.org/en/download).

*Installing Node.js will also install npm which is required for the next steps.*

1. Create a new project directory with a `package.json` file in it. You can quickly do this with `npm init`.
2. Install Kixx in your project directory by running `npm install --save kixx`.
3. Set up your project scaffolding by running `npx kixx init-project --name 'My New Web App'`.
4. Start your new web app by running `npx kixx app-server --environment development`
5. Open your browser to http://localhost:3001 to see your app.

Concepts
--------
### Improved AI Control
Use AI for what it's good at and otherwise get it out of way.

Kixx manages the LLM context from an MCP server, guiding the LLM to use convention and configuration over code to keep AI agents out of trouble. Your AI environment has the information and tools it needs to be helpful, but not so much context to waste time thrashing around.

### Developer Power
Kixx never takes away your power to shoot yourself in the foot.

You'll always have full control over your projects with the ability to extend everything with your own code while directing your AI tools in the background. All conventions and configurations can be overridden, new code can be added, and existing code can be extended.

Core Principles
---------------

### 1. Optimize for productivity.
When a decision needs to be made, we optimize for developer productivity. This is the north star of the Kixx framework, and most of the remaining priciples derive from it.

### 2. Have opinions
Kixx has opinions about building great web applications. In our opinion, a good framework needs to have opinions, otherwise, what's the point of using a framework?

### 3. Software is a craft.
Humans write software for humans, and even in the age of AI, building software is, and will always be a craft done by a craftsperson.

### 4. Remove complexity.
There will always be complexity in the problems we choose to solve with our software. But, Kixx will seek out ways to bury incidental complexity and keep our brains concentrated on the real problems.

### 5. The World Wide Web is the best application platform ever invented.
Nothing has ever been created that matches the accessibility, openness, power, and distribution of the Web. Kixx is fully committed to improving and contributing to the WWW.

### 6. AI tools can be built and used without negative moral, ethical, or environmental impacts.
We can develop AI tools to which are small, productive, focused on the craft of software development, and don't slurp up massive amounts of energy.

### 7. Favor monolithic applications over distributed architectures.
Distributed microservices might be great for large engineering teams, but Kixx is made for solo developers and small, fast moving teams. Monolithic, hypermedia driven applications, without the complexity of microservices and piles of client side JavaScript, give us a massive velocity boost over our distributed counterparts.

### 8. Convention over Configuration and Code
Wherever possible Kixx uses conventions over configuration and code for common web application logic. This dramatically reduces the amount of code that needs to be written, generated, and reasoned about to build a web app.

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

Copyright and License
---------------------
Copyright: (c) 2017 - 2025 by Kris Walker (www.kriswalker.me)

Unless otherwise indicated, all source code is licensed under the MIT license. See LICENSE for details.
