import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import {
    getAdminFiles,
    postFileMetadata,
    postFilePublish,
} from '../../../../../../src/app/presentation/request-handlers/admin-panel/admin-files.js';


describe('Admin file listing', ({ it }) => {
    it('falls back to the filename and reverse-compiles row action links', async () => {
        const store = {
            '11111111-1111-4111-8111-111111111111': makeFileRecord({
                id: '11111111-1111-4111-8111-111111111111',
                title: null,
                isPublished: false,
                content: { filename: 'report.pdf', contentType: 'application/pdf', length: 2048 },
            }),
        };
        const context = makeContext(store);
        const request = makeRequest({ queryParams: {} });
        const response = makeResponse();

        await getAdminFiles(context, request, response);

        const [ row ] = response.props.files;
        assertEqual('report.pdf', row.displayTitle);
        assertEqual('/admin/files/11111111-1111-4111-8111-111111111111', row.links.detail);
        assertEqual('/admin/files/11111111-1111-4111-8111-111111111111/publish', row.links.publish);
        assertEqual('2.0 KB', row.sizeLabel);
        assertEqual('fresh-csrf-token', response.props.csrf.token);
    });
});

describe('Admin file publish action', ({ it }) => {
    it('redirects to this file\'s own detail page, not an undefined pathname', async () => {
        const store = { '11111111-1111-4111-8111-111111111111': makeFileRecord({ id: '11111111-1111-4111-8111-111111111111', isPublished: false }) };
        const context = makeContext(store);
        const request = makeRequest({ pathnameParams: { fileId: '11111111-1111-4111-8111-111111111111' } });
        const response = makeResponse();

        await postFilePublish(context, request, response);

        assertEqual(303, response.redirect.status);
        assertEqual('/admin/files/11111111-1111-4111-8111-111111111111', response.redirect.location);
    });
});

describe('Admin file metadata action', ({ it }) => {
    it('returns field errors as JSON for a partial request instead of throwing', async () => {
        const store = { '11111111-1111-4111-8111-111111111111': makeFileRecord({ id: '11111111-1111-4111-8111-111111111111' }) };
        const context = makeContext(store);
        const request = makeRequest({
            pathnameParams: { fileId: '11111111-1111-4111-8111-111111111111' },
            partial: true,
            fields: { title: 'x'.repeat(201) },
        });
        const response = makeResponse();

        await postFileMetadata(context, request, response);

        assertEqual(422, response.json.status);
        assertMatches(/at most 200/, response.json.body.form.fields.title.error);
        // The invalid value is echoed back so the operator does not lose it.
        assertEqual('x'.repeat(201), response.json.body.form.fields.title.value);
    });

    it('redirects with a generic notice for a non-JavaScript submission', async () => {
        const store = { '11111111-1111-4111-8111-111111111111': makeFileRecord({ id: '11111111-1111-4111-8111-111111111111' }) };
        const context = makeContext(store);
        const request = makeRequest({
            pathnameParams: { fileId: '11111111-1111-4111-8111-111111111111' },
            fields: { title: 'x'.repeat(201) },
        });
        const response = makeResponse();

        await postFileMetadata(context, request, response);

        assertEqual(303, response.redirect.status);
        assertEqual('/admin/files/11111111-1111-4111-8111-111111111111?notice=metadata_invalid', response.redirect.location);
    });

    it('saves valid metadata and redirects back to the detail page', async () => {
        const store = { '11111111-1111-4111-8111-111111111111': makeFileRecord({ id: '11111111-1111-4111-8111-111111111111', title: null }) };
        const context = makeContext(store);
        const request = makeRequest({
            pathnameParams: { fileId: '11111111-1111-4111-8111-111111111111' },
            fields: { title: 'New Title', description: '' },
        });
        const response = makeResponse();

        await postFileMetadata(context, request, response);

        assertEqual('New Title', store['11111111-1111-4111-8111-111111111111'].get('title'));
        assertEqual(303, response.redirect.status);
        assertEqual('/admin/files/11111111-1111-4111-8111-111111111111', response.redirect.location);
        assertEqual(null, response.json);
    });
});


function makeFileRecord(overrides) {
    const data = Object.assign({
        id: '11111111-1111-4111-8111-111111111111',
        title: null,
        description: null,
        isPublished: false,
        originalUploadedAt: '2024-01-01T00:00:00.000Z',
        content: {
            key: 'key-1',
            filename: 'file.bin',
            contentType: 'application/octet-stream',
            length: 0,
            etag: 'etag-1',
            generation: 'gen-1',
        },
    }, overrides);

    return {
        get(name) {
            return data[name];
        },
        merge(patch) {
            Object.assign(data, patch);
            return this;
        },
        toObject() {
            return Object.assign({}, data);
        },
    };
}

const TARGET_PATTERNS = {
    'admin-panel/files/render-list': '/admin/files',
    'admin-panel/new-files/render-new': '/admin/files/new',
    'admin-panel/file-upload/upload': '/admin/files/upload',
    'admin-panel/file-detail/render-detail': '/admin/files/:fileId',
    'admin-panel/file-download/download': '/admin/files/:fileId/download',
    'files/download': '/files/:fileId',
    'admin-panel/file-publish/publish': '/admin/files/:fileId/publish',
    'admin-panel/file-unpublish/unpublish': '/admin/files/:fileId/unpublish',
    'admin-panel/file-metadata/metadata': '/admin/files/:fileId/metadata',
    'admin-panel/file-replace/replace': '/admin/files/:fileId/replace',
    'admin-panel/file-delete/delete': '/admin/files/:fileId/delete',
};

function makeContext(store) {
    const fileCollection = {
        async listPage() {
            return { items: Object.values(store), cursor: null };
        },
        async getFile(_context, id) {
            return store[id] || null;
        },
        async patch(_context, record, patch) {
            record.merge(patch);
            return record;
        },
    };
    const collections = { File: fileCollection };

    return {
        config: { env: { FILES: { maxUploadBytes: 52428800 } } },
        getCollection(name) {
            return collections[name];
        },
        getService() {
            return {
                async sign() {
                    return 'fresh-csrf-token';
                },
                async verify() {
                    return true;
                },
            };
        },
        getHttpTarget(name) {
            const pattern = TARGET_PATTERNS[name];
            return {
                compilePathname(params) {
                    const fileId = (params && params.fileId) || '';
                    return { method: 'POST', pathname: pattern.replace(':fileId', fileId) };
                },
            };
        },
    };
}

function makeRequest(options) {
    const { queryParams = {}, pathnameParams = {}, partial = false, fields = {} } = options;
    const formData = new FormData();
    formData.set('csrf_token', 'submitted-token');
    for (const [ name, value ] of Object.entries(fields)) {
        formData.set(name, value);
    }

    const headers = new Map();
    if (partial) {
        headers.set('kixx-partial', 'row');
    }

    return {
        queryParams,
        pathnameParams,
        url: new URL('https://example.com/admin/files'),
        headers: { get: (name) => headers.get(name.toLowerCase()) || null },
        async formData() {
            return formData;
        },
        getCookie(name) {
            return name === 'kixx_csrf_session' ? 'browser-session' : null;
        },
    };
}

function makeResponse() {
    return {
        props: {},
        status: 200,
        redirect: null,
        json: null,
        setCookie() {
            return this;
        },
        updateProps(props) {
            Object.assign(this.props, props);
            return this;
        },
        respondWithRedirect(status, location) {
            this.redirect = { status, location };
            return this;
        },
        respondWithJSON(status, body) {
            this.status = status;
            this.json = { status, body };
            return this;
        },
    };
}
