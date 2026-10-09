import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { getDeveloperBlob } from '../../../../src/plugins/node-content-store/lib/developer-blobs.js';


async function makeSource(root, filename, source) {
    const filepath = path.join(root, filename);
    await fsp.writeFile(filepath, source);
    const stats = await fsp.stat(filepath);
    return { filepath, mtimeMs: stats.mtimeMs, size: stats.size };
}

describe('getDeveloperBlob', ({ it }) => {
    it('materializes file, partial, include, and email recipes', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-blobs-'));
        try {
            const template = await makeSource(root, 'template.html', 'Hello {{ name }}');
            const partial = await makeSource(root, 'partial.html', 'Partial');
            const include = await makeSource(root, 'include.html', '<p>Include</p>');
            const manifest = new Map([
                [ '/asset.txt', { kind: 'file', sources: [ template ], manifests: [] } ],
                [ '/partials', { kind: 'partials', sources: [ { id: 'card.html', ...partial } ], manifests: [] } ],
                [ '/includes', { kind: 'includes', sources: [ { name: 'body', ...include } ], manifests: [] } ],
                [ '/email', {
                    kind: 'email',
                    sources: [
                        { role: 'htmlTemplate', id: 'message.html', ...template },
                        { role: 'partial', id: 'card.html', ...partial },
                    ],
                    manifests: [],
                    contextData: { subject: 'Welcome' },
                } ],
            ]);

            assertEqual('Hello {{ name }}', await getDeveloperBlob(manifest, '/asset.txt', 'text'));
            assertEqual(
                JSON.stringify([ { id: 'card.html', source: 'Partial' } ]),
                JSON.stringify(JSON.parse(await getDeveloperBlob(manifest, '/partials', 'text'))),
            );
            assertEqual(
                JSON.stringify({ body: '<p>Include</p>' }),
                JSON.stringify(JSON.parse(await getDeveloperBlob(manifest, '/includes', 'text'))),
            );
            assertEqual(JSON.stringify({
                contextData: { subject: 'Welcome' },
                htmlTemplate: { id: 'message.html', source: 'Hello {{ name }}' },
                includes: {},
                partials: [ { id: 'card.html', source: 'Partial' } ],
            }), JSON.stringify(JSON.parse(await getDeveloperBlob(manifest, '/email', 'text'))));
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('returns exact binary bytes and a cancellable stream', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-blobs-'));
        try {
            const source = await makeSource(root, 'asset.bin', new Uint8Array([ 0, 1, 255 ]));
            const manifest = new Map([[ '/asset.bin', { kind: 'file', sources: [ source ], manifests: [] } ]]);
            const arrayBuffer = await getDeveloperBlob(manifest, '/asset.bin', 'arrayBuffer');
            const stream = await getDeveloperBlob(manifest, '/asset.bin', 'stream');

            assertEqual('0,1,255', [ ...new Uint8Array(arrayBuffer) ].join(','));
            assert(stream instanceof ReadableStream);
            await stream.cancel();
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('resolves null when a source disappears after scanning', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-blobs-'));
        try {
            const source = await makeSource(root, 'asset.txt', 'gone soon');
            const manifest = new Map([[ '/asset.txt', { kind: 'file', sources: [ source ], manifests: [] } ]]);
            await fsp.unlink(source.filepath);

            assertEqual(null, await getDeveloperBlob(manifest, '/asset.txt', 'text'));
            assertEqual(null, await getDeveloperBlob(manifest, '/missing', 'text'));
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });
});
