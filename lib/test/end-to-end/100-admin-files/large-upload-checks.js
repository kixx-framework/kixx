// Manual large-upload checks for the admin file library.
//
// These exercise the configured per-file limit with real bytes, which the e2e
// runner's 10 second test ceiling cannot hold, so this is a standalone script
// rather than a *.test.js file. It targets whatever the e2e suite targets:
//
//   E2E_TESTS_BASE_URL=... E2E_TESTS_ROOT_USERNAME=... E2E_TESTS_ROOT_PASSWORD=... \
//     node test/end-to-end/100-admin-files/large-upload-checks.js
//
// Fixture bytes are random and written to a temporary directory, then sent as
// file-backed Blobs so neither this script nor the target has to hold a whole
// upload in memory. Every file the script creates is deleted before it exits.
// See docs/admin-files.md for what each check proves and how to record it.
import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import {
    FileFixtures,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    openUploadPage,
    postFileAction,
    sendUpload,
} from './helpers.js';


const CHUNK_BYTES = 1024 * 1024;
const CONCURRENT_UPLOADS = 3;

const results = [];


async function main() {
    const rootCookies = await loginRootAdmin();
    const { csrfToken, maxUploadBytes } = await openUploadPage(rootCookies);
    const fixtures = new FileFixtures(rootCookies, csrfToken);
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-large-uploads-'));

    print(`Target: ${ getBaseUrl() }`);
    print(`Configured maxUploadBytes: ${ maxUploadBytes }`);

    try {
        const limitFile = path.join(directory, 'limit.bin');
        const overLimitFile = path.join(directory, 'limit-plus-one.bin');
        const limitDigest = await writeRandomFile(limitFile, maxUploadBytes);
        await writeRandomFile(overLimitFile, maxUploadBytes + 1);

        const context = { rootCookies, csrfToken, maxUploadBytes, fixtures, limitFile, limitDigest, overLimitFile };

        await check('zero bytes', () => checkZeroBytes(context));
        await check('exactly the configured limit', () => checkLimitUpload(context));
        await check(`${ CONCURRENT_UPLOADS } concurrent uploads at the limit`, () => checkConcurrentUploads(context));

        // Rejected uploads return no id, so the listing is the observable
        // evidence that none of them committed a file record.
        const idsBefore = await listFileIds(rootCookies);
        await check('limit + 1 bytes, declared', () => checkDeclaredOverLimit(context));
        await check('limit + 1 bytes, declared as the limit', () => checkUndeclaredOverLimit(context));
        await check('disconnect after half the declared bytes', () => checkDisconnect(context));
        await check('rejected uploads created no file records', async () => {
            const idsAfter = await listFileIds(rootCookies);
            assertCheck(idsAfter.join(',') === idsBefore.join(','), 'listing changed after rejected uploads');
            return 'listing unchanged';
        });
    } finally {
        await fixtures.cleanup();
        await fsp.rm(directory, { recursive: true, force: true });
    }

    const failures = results.filter(({ ok }) => !ok);
    print(`\n${ results.length - failures.length } passed, ${ failures.length } failed`);
    process.exitCode = failures.length > 0 ? 1 : 0;
}

async function checkZeroBytes(context) {
    const { rootCookies, csrfToken, fixtures } = context;

    const upload = await sendUpload(rootCookies, {
        csrfToken,
        filename: createFixtureFilename('large-zero', 'bin'),
        body: new Uint8Array(0),
    });
    fixtures.track(upload.json?.file?.id);
    assertCheck(upload.status === 201, `upload status ${ upload.status }: ${ upload.text }`);
    assertCheck(upload.json.file.content.length === 0, 'stored length is not 0');

    return 'stored 0 bytes';
}

async function checkLimitUpload(context) {
    const { rootCookies, csrfToken, maxUploadBytes, fixtures, limitFile, limitDigest } = context;

    const upload = await sendUpload(rootCookies, {
        csrfToken,
        filename: createFixtureFilename('large-limit', 'bin'),
        body: await fs.openAsBlob(limitFile),
    });
    fixtures.track(upload.json?.file?.id);
    assertCheck(upload.status === 201, `upload status ${ upload.status }: ${ upload.text }`);
    assertCheck(upload.json.file.content.length === maxUploadBytes, 'stored length differs from the limit');

    // Publish and read the bytes back to prove the stored object is complete,
    // not just that its metadata claims the right length.
    const fileId = upload.json.file.id;
    const published = await postFileAction(rootCookies, csrfToken, fileId, 'publish', { isPartial: true });
    assertCheck(published.status === 200, `publish status ${ published.status }`);

    const served = await fetch(`${ getBaseUrl() }/files/${ fileId }`);
    assertCheck(served.status === 200, `public GET status ${ served.status }`);
    const servedDigest = await digestStream(served.body);
    assertCheck(servedDigest === limitDigest, 'served bytes differ from the uploaded bytes');

    await postFileAction(rootCookies, csrfToken, fileId, 'unpublish', { isPartial: true });

    return `stored and served ${ maxUploadBytes } bytes, SHA-256 matches`;
}

async function checkConcurrentUploads(context) {
    const { rootCookies, csrfToken, maxUploadBytes, fixtures, limitFile } = context;

    const uploads = await Promise.all(Array.from({ length: CONCURRENT_UPLOADS }, async (_value, index) => {
        return await sendUpload(rootCookies, {
            csrfToken,
            filename: createFixtureFilename(`large-concurrent-${ index }`, 'bin'),
            body: await fs.openAsBlob(limitFile),
        });
    }));

    for (const upload of uploads) {
        fixtures.track(upload.json?.file?.id);
    }
    for (const upload of uploads) {
        assertCheck(upload.status === 201, `upload status ${ upload.status }: ${ upload.text }`);
        assertCheck(upload.json.file.content.length === maxUploadBytes, 'stored length differs from the limit');
    }

    return `${ CONCURRENT_UPLOADS } x ${ maxUploadBytes } bytes stored`;
}

async function checkDeclaredOverLimit(context) {
    const { rootCookies, csrfToken, overLimitFile } = context;

    const outcome = await sendRejectableUpload(rootCookies, {
        csrfToken,
        filename: createFixtureFilename('large-over-declared', 'bin'),
        body: await fs.openAsBlob(overLimitFile),
    });

    // The server may answer before the client finishes sending and close the
    // connection; a closed connection with no record is still a rejection.
    if (outcome.error) {
        return `connection closed before a response (${ outcome.error })`;
    }
    assertCheck(outcome.status === 413, `status ${ outcome.status }: ${ outcome.text }`);
    assertCheck(outcome.json?.error?.code === 'FileUploadTooLarge', `code ${ outcome.json?.error?.code }`);

    return '413 FileUploadTooLarge';
}

async function checkUndeclaredOverLimit(context) {
    const { rootCookies, csrfToken, maxUploadBytes, overLimitFile } = context;

    const outcome = await sendRejectableUpload(rootCookies, {
        csrfToken,
        filename: createFixtureFilename('large-over-undeclared', 'bin'),
        body: await fs.openAsBlob(overLimitFile),
        declaredSize: maxUploadBytes,
    });

    if (outcome.error) {
        return `connection closed before a response (${ outcome.error })`;
    }
    assertCheck(outcome.status === 400, `status ${ outcome.status }: ${ outcome.text }`);
    assertCheck(outcome.json?.error?.code === 'FileContentLengthMismatch', `code ${ outcome.json?.error?.code }`);

    return '400 FileContentLengthMismatch';
}

async function checkDisconnect(context) {
    const { rootCookies, csrfToken, maxUploadBytes, limitFile } = context;

    const url = new URL(`${ getBaseUrl() }/admin/files/upload`);
    const headers = {
        cookie: rootCookies.cookieHeader(),
        'content-type': 'application/octet-stream',
        'content-length': String(maxUploadBytes),
        'x-kixx-csrf-token': csrfToken,
        'x-file-name': encodeURIComponent(createFixtureFilename('large-disconnect', 'bin')),
        'x-file-size': String(maxUploadBytes),
    };

    const outcome = await sendTruncatedRequest(url, headers, limitFile, Math.floor(maxUploadBytes / 2));
    assertCheck(outcome === 'disconnected', outcome);

    // The target must keep serving after the aborted request.
    const health = await fetchPathname(rootCookies, '/admin/files');
    assertCheck(health.status === 200, `target returned ${ health.status } after the disconnect`);

    return `sent ${ Math.floor(maxUploadBytes / 2) } of ${ maxUploadBytes } bytes, then closed the socket; target healthy`;
}

async function sendRejectableUpload(cookies, options) {
    try {
        return await sendUpload(cookies, options);
    } catch (error) {
        return { error: error.cause?.code || error.message };
    }
}

// Writes the declared Content-Length but only part of the body, then destroys
// the socket: an interrupted browser upload, not a well-formed short body.
function sendTruncatedRequest(url, headers, filepath, byteCount) {
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
        const request = client.request(url, { method: 'POST', headers });
        let isSettled = false;

        function settle(outcome) {
            if (!isSettled) {
                isSettled = true;
                resolve(outcome);
            }
        }

        request.on('response', (response) => {
            response.resume();
            settle(`target responded ${ response.statusCode } before the disconnect`);
        });

        // Destroying our own socket surfaces here; that is the expected path.
        request.on('error', () => settle('disconnected'));

        const source = fs.createReadStream(filepath, { start: 0, end: byteCount - 1 });
        source.on('end', () => {
            setTimeout(() => {
                request.destroy();
                settle('disconnected');
            }, 500);
        });
        source.pipe(request, { end: false });
    });
}

async function writeRandomFile(filepath, byteCount) {
    const hash = createHash('sha256');
    const handle = await fsp.open(filepath, 'w');

    try {
        for (let written = 0; written < byteCount; written += CHUNK_BYTES) {
            const chunk = randomBytes(Math.min(CHUNK_BYTES, byteCount - written));
            hash.update(chunk);
            // eslint-disable-next-line no-await-in-loop
            await handle.write(chunk);
        }
    } finally {
        await handle.close();
    }

    return hash.digest('hex');
}

async function digestStream(stream) {
    const hash = createHash('sha256');
    for await (const chunk of stream) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

async function listFileIds(cookies) {
    const listing = await fetchPathname(cookies, '/admin/files');
    return getListingRows(listing.text).map(({ id }) => id);
}

async function check(name, fn) {
    const start = Date.now();
    try {
        const detail = await fn();
        results.push({ name, ok: true });
        print(`PASS  ${ name } (${ Date.now() - start }ms): ${ detail }`);
    } catch (error) {
        results.push({ name, ok: false });
        print(`FAIL  ${ name } (${ Date.now() - start }ms): ${ error.message }`);
    }
}

function print(line) {
    process.stdout.write(`${ line }\n`);
}

function assertCheck(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

await main();
