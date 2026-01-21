The `dev-server` command runs a Node.js script and
automatically restarts it when watched files change.

This is useful for development workflows where you want
your server to automatically reload when you make changes.

Usage
-----

    kixx dev-server <script> [options] [-- script-args...]

Arguments
---------

<script> *required*
    The path to the Node.js script to run.

[script-args...] *optional*
    Arguments to pass to the script. Place these after `--` to
    separate them from dev-server options.

Options
-------

--watch (-w) *optional*
    The directory to watch for file changes.

    If not provided, defaults to the directory containing
    the script.

--pattern (-p) *optional*
    A glob pattern to filter which files trigger a restart.

    Default: "**/*.js"

    Supports common glob syntax:
    - `*` matches any characters except path separator
    - `**` matches any characters including path separator
    - `?` matches a single character
    - `{a,b}` matches either a or b

--debounce (-d) *optional*
    Debounce delay in milliseconds before restarting after
    a file change.

    Default: 300

Examples
--------

Run a server script and watch its directory:

    kixx dev-server ./server.js

Watch a specific directory with a custom pattern:

    kixx dev-server ./server.js --watch ./lib --pattern "**/*.{js,json}"

Pass arguments to the script:

    kixx dev-server ./server.js -- --port 3000 --env development
