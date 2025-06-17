/*
The MIT License

Copyright (c) 2017 - 2025 Kris Walker (www.kriswalker.me).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
import process from 'node:process';
import { EOL } from 'node:os';

/*
Logging features:

- Multilevel logging (DEBUG, INFO, WARN, ERROR).
- Create named child loggers which inherit the name, logging mode, and level from the parent.
- Dynamically change the log level or logging mode after the logger is created.

Supports 4 levels of logging:

| Level Name | Level Integer | Supported Methods |
|------------|---------------|-------------------|
| DEBUG      | 10            | debug()           |
| INFO       | 20            | info()            |
| WARN       | 30            | warn()            |
| ERROR      | 40            | error()           |
*/

const LEVELS = Object.freeze({
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
});

// An Array of level string names
const LEVELS_NAMES = Object.freeze(Object.keys(LEVELS));

// An Array of level integers.
const LEVELS_INTEGERS = Object.freeze(LEVELS_NAMES.map((key) => LEVELS[key]));

// Create a Map of level integers as keys to string names as values.
const LEVELS_INTEGERS_MAP = Object.freeze(LEVELS_NAMES.reduce((map, nameKey) => {
    const intKey = LEVELS[nameKey];
    map.set(intKey, nameKey);
    return map;
}, new Map()));

const MODES = Object.freeze({
    // The "console" logging mode is designed for development environments.
    CONSOLE: 'console',
    // The "stdout" logging mode is designed for production environments.
    STDOUT: 'stdout',
    // The "silent" logging mode turns off logging for testing.
    SILENT: 'silent',
});

const ACCEPTED_MODES = Object.freeze(Object.values(MODES));


export default class Logger {

    #levelInteger = LEVELS.INFO;
    #mode = 'stdout';
    #children = new Set();

    constructor(options) {
        const { name, level, mode } = options || {};

        if (!name || typeof name !== 'string') {
            throw new Error('A logger must be provided with a name');
        }

        Object.defineProperty(this, 'name', {
            enumerable: true,
            value: name,
        });

        if (typeof level === 'string' || Number.isInteger(level)) {
            // Invoke `set level()` below.
            this.level = level;
        }

        if (mode && typeof mode === 'string') {
            // Invoke `set mode()` below.
            this.mode = mode;
        }
    }

    get level() {
        return LEVELS_INTEGERS_MAP.get(this.#levelInteger);
    }

    set level(level) {
        if (level && typeof level === 'string') {
            level = level.toUpperCase();
            if (!LEVELS_NAMES.includes(level)) {
                throw new Error(`Logger:set level : "${ level }" is an invalid level name`);
            }
            this.#levelInteger = LEVELS[level];
        } else {
            if (!LEVELS_INTEGERS.includes(level)) {
                throw new Error(`Logger:set level : ${ level } is an invalid level integer`);
            }
            this.#levelInteger = level;
        }

        for (const logger of this.#children) {
            logger.level = level;
        }
    }

    get mode() {
        return this.#mode;
    }

    set mode(mode) {
        if (!ACCEPTED_MODES.includes(mode)) {
            throw new Error(`Logger:set mode : "${ mode }" is an invalid mode`);
        }

        this.#mode = mode;

        for (const logger of this.#children) {
            logger.mode = mode;
        }
    }

    createChild(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Logger:createChild(name) name: must be a string');
        }

        const logger = new Logger({
            name: `${ this.name }:${ name }`,
            level: this.#levelInteger,
            mode: this.#mode,
        });

        this.#children.add(logger);

        return logger;
    }

    debug(message, info, error) {
        if (this.#levelInteger <= LEVELS.DEBUG) {
            this.printMessage(LEVELS.DEBUG, message, info, error);
        }
    }

    info(message, info, error) {
        if (this.#levelInteger <= LEVELS.INFO) {
            this.printMessage(LEVELS.INFO, message, info, error);
        }
    }

    warn(message, info, error) {
        if (this.#levelInteger <= LEVELS.WARN) {
            this.printMessage(LEVELS.WARN, message, info, error);
        }
    }

    error(message, info, error) {
        if (this.#levelInteger <= LEVELS.ERROR) {
            this.printMessage(LEVELS.ERROR, message, info, error);
        }
    }

    printMessage(intLevel, message, info, error) {
        switch (this.#mode) {
            case MODES.CONSOLE:
                this.printConsoleMessage(intLevel, message, info, error);
                break;
            case MODES.STDOUT:
                this.printStdoutMessage(intLevel, message, info, error);
                break;
        }
    }

    printConsoleMessage(intLevel, message, info, error) {
        const datetime = getCurrentHumanDateTimeString();
        const { name } = this;
        // Convert the level integer to a padded string.
        const level = `${ LEVELS_INTEGERS_MAP.get(intLevel) } `.slice(0, 5);

        if (info && error) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', info, '-', error);
        } else if (info) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', info);
        } else if (error) {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message, '-', error);
        } else {
            // eslint-disable-next-line no-console
            console.log(datetime, level, name, message);
        }
    }

    printStdoutMessage(intLevel, message, info, error) {
        const now = new Date();
        const datetime = now.toISOString();
        const { name } = this;
        const { pid } = process;
        // Convert the level integer to a padded string.
        const level = `${ LEVELS_INTEGERS_MAP.get(intLevel) } `.slice(0, 5);

        const infoString = info
            ? JSON.stringify(info)
            : 'null';

        const errorString = error
            ? JSON.stringify(formatError(error))
            : 'null';

        const line = [
            datetime,
            level,
            pid,
            name,
            message,
            infoString,
            errorString,
        ].join(' - ');

        process.stdout.write(line + EOL);
    }
}

Object.defineProperties(Logger, {
    LEVELS: {
        enumerable: true,
        value: LEVELS,
    },
    MODES: {
        enumerable: true,
        value: MODES,
    },
});

function getCurrentHumanDateTimeString() {
    const d = new Date();
    const hours = padNumber2(d.getHours());
    const minutes = padNumber2(d.getMinutes());
    const seconds = padNumber2(d.getSeconds());
    const mseconds = padNumber3(d.getMilliseconds());
    return `${ hours }:${ minutes }:${ seconds }.${ mseconds }`;
}

function formatError(error) {
    const name = error.name || '[NO_NAME]';
    const code = error.code || '[NO_CODE]';
    const message = error.message || '[NO_MESSAGE]';
    const stack = error.stack || '[NO_STACK]';

    return { name, code, message, stack };
}

function padNumber2(n) {
    return ('00' + n).slice(-2);
}

function padNumber3(n) {
    return ('000' + n).slice(-3);
}
