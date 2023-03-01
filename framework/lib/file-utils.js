// @ts-check

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { OperationalError } from 'kixx-server-errors';
import toml from 'toml';

/**
 * @param  {String}  filepath
 * @return {Boolean}
 */
export function isDirectory(filepath) {
    const stat = fs.statSync(filepath, { throwIfNoEntry: false });
    return Boolean(stat && stat.isDirectory());
}

/**
 * This function could be extended to support other config file formats.
 * @param  {String}  filepath
 * @return {Promise<Object>}
 */
export async function readConfigFile(filepath) {
    let utf8Text;
    try {
        utf8Text = await fsp.readFile(filepath, 'utf8');
    } catch (/** @type {any} */cause) {
        throw new OperationalError(
            `Error (${ cause.code }) reading configuration file ${ filepath }`,
            {
                cause,
                info: { filepath },
            }
        );
    }

    try {
        return toml.parse(utf8Text);
    } catch (/** @type {any} */cause) {
        throw new OperationalError(
            `Config file parsing error on line ${ cause.line } : ${ cause.column } : ${ cause.message } in file ${ filepath }`,
            {
                cause,
                info: {
                    filepath,
                    line: cause.line,
                    column: cause.column,
                    message: cause.message,
                },
            }
        );
    }
}

/**
 * @param  {Object}   stream
 * @param  {Function} callback [description]
 * @return {void}
 */
export function onStreamFinished(stream, callback) {
    let isResolved = false;

    function maybeResolve() {
        if (!isResolved) {
            isResolved = true;
            callback();
        }
    }

    stream.on('error', maybeResolve);
    stream.on('close', maybeResolve);
    stream.on('end', maybeResolve);
    stream.on('finish', maybeResolve);
}
