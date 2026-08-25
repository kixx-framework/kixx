import fsp from 'node:fs/promises';

import { assert, assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';
import { canonicalize } from '../../../kixx/content-addressable-store/addressing.js';


/**
 * Materializes one developer source recipe in the requested representation.
 *
 * @param {Map<string, Object>} manifest - Storage pathnames and source recipes
 * @param {string} pathname - Canonical storage pathname
 * @param {'text'|'arrayBuffer'|'stream'} type - Requested representation
 * @param {Object} [fileSystem] - Promise-based filesystem API used by tests
 * @returns {Promise<string|ArrayBuffer|ReadableStream|null>} Materialized value, or null when absent
 */
export async function getDeveloperBlob(manifest, pathname, type, fileSystem = fsp) {
    assert(manifest instanceof Map, 'getDeveloperBlob: manifest must be a Map');
    assertNonEmptyString(pathname, 'getDeveloperBlob: pathname');
    assert([ 'text', 'arrayBuffer', 'stream' ].includes(type), 'getDeveloperBlob: unsupported type');

    const recipe = manifest.get(pathname);
    if (!recipe) {
        return null;
    }

    const value = await materializeRecipe(recipe, fileSystem);
    if (value === null) {
        return null;
    }
    if (type === 'text') {
        return typeof value === 'string' ? value : new TextDecoder().decode(value);
    }

    const arrayBuffer = typeof value === 'string'
        ? new TextEncoder().encode(value).buffer
        : toArrayBuffer(value);
    if (type === 'arrayBuffer') {
        return arrayBuffer;
    }
    return arrayBufferToStream(arrayBuffer);
}

async function materializeRecipe(recipe, fileSystem) {
    for (const manifest of recipe.manifests) {
        if (!await sourceExists(manifest, fileSystem)) {
            return null;
        }
    }

    if (recipe.kind === 'file') {
        return await readSource(recipe.sources[0], fileSystem, null);
    }

    const sources = [];
    for (const source of recipe.sources) {
        const text = await readSource(source, fileSystem, 'utf8');
        if (text === null) {
            return null;
        }
        sources.push({ ...source, source: text });
    }

    if (recipe.kind === 'partials') {
        return canonicalize(sources.map(({ id, source }) => ({ id, source })));
    }
    if (recipe.kind === 'includes') {
        return canonicalize(Object.fromEntries(sources.map(({ name, source }) => [ name, source ])));
    }
    if (recipe.kind === 'email') {
        const bundle = {
            contextData: recipe.contextData,
            partials: sources
                .filter(({ role }) => role === 'partial')
                .map(({ id, source }) => ({ id, source })),
            includes: {},
        };
        for (const source of sources) {
            if (source.role === 'htmlTemplate' || source.role === 'textTemplate') {
                bundle[source.role] = { id: source.id, source: source.source };
            }
        }
        return canonicalize(bundle);
    }

    assert(false, `getDeveloperBlob: unknown recipe kind "${ recipe.kind }"`);
}

async function sourceExists(source, fileSystem) {
    try {
        await fileSystem.stat(source.filepath);
        return true;
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return false;
        }
        throw new OperationalError(`Failed to inspect developer source file "${ source.filepath }"`, { cause });
    }
}

async function readSource(source, fileSystem, encoding) {
    try {
        return await fileSystem.readFile(source.filepath, encoding ?? undefined);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw new OperationalError(`Failed to read developer source file "${ source.filepath }"`, { cause });
    }
}

function toArrayBuffer(value) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function arrayBufferToStream(arrayBuffer) {
    let isSent = false;
    return new ReadableStream({
        pull(controller) {
            if (!isSent) {
                isSent = true;
                controller.enqueue(new Uint8Array(arrayBuffer));
            }
            controller.close();
        },
        cancel() {
            isSent = true;
        },
    });
}
