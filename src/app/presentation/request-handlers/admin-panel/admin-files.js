import { BadRequestError, NotFoundError } from '../../../../kixx/errors/mod.js';
import FileActionForm from '../../forms/files/file-action-form.js';
import FileMetadataForm from '../../forms/files/file-metadata-form.js';
import FileUploadTransportForm from '../../forms/files/file-upload-transport-form.js';
import UploadFileForm from '../../forms/files/upload-file-form.js';
import { getCsrfFormContext, getCsrfToken, validateCsrfFormData, validateCsrfHeader } from '../../lib/csrf.js';
import {
    createCursorPaginationLinks,
    getCursorPaginationQueryParams,
    rethrowInvalidCursorAsBadRequest,
} from '../../lib/pagination.js';
import { createFile } from '../../../transaction-scripts/files/create-file.js';
import { deleteFile } from '../../../transaction-scripts/files/delete-file.js';
import { getFile } from '../../../transaction-scripts/files/get-file.js';
import { listFiles } from '../../../transaction-scripts/files/list-files.js';
import { publishFile } from '../../../transaction-scripts/files/publish-file.js';
import { replaceFile } from '../../../transaction-scripts/files/replace-file.js';
import { unpublishFile } from '../../../transaction-scripts/files/unpublish-file.js';
import { updateFileMetadata } from '../../../transaction-scripts/files/update-file-metadata.js';

// Query notice shown on the detail page after a no-JavaScript metadata submission
// fails validation. The POST route has no page-render step of its own (see
// fileActionRoutes() in routes/admin-panel.js), so the specific invalid text
// cannot be echoed back across a redirect — only a generic notice can. A
// JavaScript client instead gets the full field-level errors inline; see
// postFileMetadata() below.
const METADATA_INVALID_NOTICE = 'metadata_invalid';
const ALLOWED_FILE_NOTICES = new Set([ METADATA_INVALID_NOTICE ]);

// Checkbox name in the detail page's delete form (pages/admin/files/detail).
const DELETE_CONFIRMATION_FIELD = 'confirm_delete';

/** Loads the paginated admin file listing for Hyperview rendering. */
export async function getAdminFiles(context, request, response) {
    const pagination = getCursorPaginationQueryParams(request.queryParams);

    let page;
    try {
        page = await listFiles(context, pagination.cursor);
    } catch (cause) {
        // Never returns — it either translates an InvalidCursorError into a 400 or
        // rethrows, so `page` is always assigned by the time it is read below.
        rethrowInvalidCursorAsBadRequest(cause);
    }

    const { items, cursor: nextCursor } = page;
    const csrf = await getCsrfToken(context, request, response);
    const links = createCursorPaginationLinks({
        pathname: getFilesListPathname(context),
        cursor: pagination.cursor,
        history: pagination.history,
        nextCursor,
    });

    return response.updateProps({
        files: items.map((file) => decorateFileRow(context, file)),
        showPagination: Boolean(links.nextPage || links.previousPage),
        csrf,
        links: Object.assign({ newFiles: getNewFilesPathname(context) }, links),
    });
}

/** Renders the batch upload page with the CSRF token the upload queue needs. */
export async function getNewFiles(context, request, response) {
    const upload = await getCsrfFormContext(context, request, response, new FileUploadTransportForm());

    return response.updateProps({
        upload,
        maxUploadBytes: context.config.env.FILES.maxUploadBytes,
        links: { filesList: getFilesListPathname(context) },
    });
}

/** Loads one file for the admin detail page. */
export async function getAdminFile(context, request, response) {
    const action = makeActionForm(request);
    action.validate();
    const file = await requireFileForDisplay(context, action.fileId);
    const rawNotice = request.queryParams.notice;

    return response.updateProps({
        metadataInvalid: ALLOWED_FILE_NOTICES.has(rawNotice) && rawNotice === METADATA_INVALID_NOTICE,
        links: { filesList: getFilesListPathname(context) },
        ...await getFileDetailProps(context, request, response, file),
    });
}

/** Validates a raw upload before streaming it into the file lifecycle. */
export async function postFileUpload(context, request, response) {
    await validateCsrfHeader(context, request);
    const form = makeUploadForm(context, request);
    const file = await createFile(context, form);
    return response.respondWithJSON(201, getFileResult(context, file));
}

/** Replaces the current bytes without changing the file identity. */
export async function postFileReplacement(context, request, response) {
    await validateCsrfHeader(context, request);
    const action = makeActionForm(request);
    action.validate();
    const file = await replaceFile(context, action.fileId, makeUploadForm(context, request));
    return response.respondWithJSON(200, getFileResult(context, file));
}

/** Updates only admin metadata. */
export async function postFileMetadata(context, request, response) {
    const formData = await validateCsrfFormData(context, request);
    const action = makeActionForm(request);
    action.validate();

    const form = FileMetadataForm.fromFormData(formData);
    form.fileId = action.fileId;

    try {
        form.validate();
    } catch (error) {
        if (error.name !== 'ValidationError') {
            throw error;
        }
        return await renderMetadataValidationError(context, request, response, form, error);
    }

    const file = await updateFileMetadata(context, action.fileId, form);
    return respondAfterAction(context, request, response, file);
}

/** Publishes the current file generation. */
export async function postFilePublish(context, request, response) {
    await validateCsrfFormData(context, request);
    const file = await publishFile(context, validatedAction(request));
    return respondAfterAction(context, request, response, file);
}

/** Unpublishes a file without changing its permanent pathname. */
export async function postFileUnpublish(context, request, response) {
    await validateCsrfFormData(context, request);
    const file = await unpublishFile(context, validatedAction(request));
    return respondAfterAction(context, request, response, file);
}

/** Permanently deletes an unpublished file once the operator confirms it. */
export async function postFileDelete(context, request, response) {
    const formData = await validateCsrfFormData(context, request);
    const action = validatedAction(request);

    // The detail form's required checkbox is only a browser check; recheck it
    // so a crafted or scripted submission cannot skip the confirmation.
    if (formData.get(DELETE_CONFIRMATION_FIELD) !== 'yes') {
        throw new BadRequestError('Confirm the permanent deletion before deleting the file', {
            code: 'FileDeleteNotConfirmed',
        });
    }

    const file = await deleteFile(context, action);
    if (request.headers.get('kixx-partial')) {
        return response.respondWithJSON(200, { file, deleted: true });
    }
    return redirect(response, context, 'admin-panel/files/render-list');
}

async function requireFileForDisplay(context, fileId) {
    const file = await getFile(context, fileId);
    if (!file) {
        throw new NotFoundError('File was not found', { code: 'FileNotFound' });
    }
    return file;
}

async function getFileDetailProps(context, request, response, file) {
    const form = new FileMetadataForm({
        title: file.title,
        description: file.description,
        fileId: file.id,
    });

    return {
        file: decorateFileDetail(context, request, file),
        form: await getCsrfFormContext(context, request, response, form),
    };
}

// A metadata validation failure has no page-render step on this POST route (see
// fileActionRoutes() in routes/admin-panel.js), so a JavaScript row editor gets
// field errors inline through JSON, preserving the text it typed; a plain HTML
// submission redirects to the detail page with a generic notice instead, since
// the specific invalid text cannot survive a redirect.
async function renderMetadataValidationError(context, request, response, form, error) {
    if (request.headers.get('kixx-partial')) {
        response.status = error.httpStatusCode || 400;
        return response.respondWithJSON(response.status, {
            error: { code: error.code || 'ValidationError', message: error.message },
            form: await getCsrfFormContext(context, request, response, form, error),
        });
    }
    return redirect(
        response,
        context,
        'admin-panel/file-detail/render-detail',
        { fileId: form.fileId },
        METADATA_INVALID_NOTICE,
    );
}

function makeUploadForm(context, request) {
    let filename;
    try {
        filename = decodeURIComponent(request.headers.get('x-file-name') || '');
    } catch (cause) {
        throw new BadRequestError('The encoded filename is invalid', { cause, code: 'InvalidFileNameEncoding' });
    }
    const declaredLength = request.headers.get('x-file-size');
    return new UploadFileForm({
        filename,
        contentType: request.getContentMediaType(),
        contentLength: declaredLength === null ? null : Number(declaredLength),
        body: request.body,
        maxUploadBytes: context.config.env.FILES.maxUploadBytes,
    });
}

function makeActionForm(request) {
    return new FileActionForm({ fileId: request.pathnameParams.fileId });
}

function validatedAction(request) {
    const form = makeActionForm(request);
    form.validate();
    return form;
}

function respondAfterAction(context, request, response, file) {
    if (request.headers.get('kixx-partial')) {
        return response.respondWithJSON(200, getFileResult(context, file));
    }
    return redirect(response, context, 'admin-panel/file-detail/render-detail', { fileId: file.id });
}

function getFilesListPathname(context) {
    return context.getHttpTarget('admin-panel/files/render-list').compilePathname().pathname;
}

function getNewFilesPathname(context) {
    return context.getHttpTarget('admin-panel/new-files/render-new').compilePathname().pathname;
}

function getFileActionLinks(context, fileId) {
    return {
        detail: context.getHttpTarget('admin-panel/file-detail/render-detail').compilePathname({ fileId }).pathname,
        download: context.getHttpTarget('admin-panel/file-download/download').compilePathname({ fileId }).pathname,
        public: context.getHttpTarget('files/download').compilePathname({ fileId }).pathname,
        publish: context.getHttpTarget('admin-panel/file-publish/publish').compilePathname({ fileId }).pathname,
        unpublish: context.getHttpTarget('admin-panel/file-unpublish/unpublish').compilePathname({ fileId }).pathname,
        metadata: context.getHttpTarget('admin-panel/file-metadata/metadata').compilePathname({ fileId }).pathname,
        replace: context.getHttpTarget('admin-panel/file-replace/replace').compilePathname({ fileId }).pathname,
        delete: context.getHttpTarget('admin-panel/file-delete/delete').compilePathname({ fileId }).pathname,
    };
}

// Row shape for the listing page: title falls back to the filename for display
// only — the stored title stays null so the fallback keeps tracking filename
// changes made by a later replacement.
function decorateFileRow(context, file) {
    return {
        id: file.id,
        displayTitle: file.title || file.content.filename,
        filename: file.content.filename,
        sizeLabel: formatByteSize(file.content.length),
        isPublished: file.isPublished,
        links: getFileActionLinks(context, file.id),
    };
}

function decorateFileDetail(context, request, file) {
    const links = getFileActionLinks(context, file.id);
    return {
        id: file.id,
        title: file.title,
        description: file.description,
        displayTitle: file.title || file.content.filename,
        filename: file.content.filename,
        contentType: file.content.contentType,
        sizeLabel: formatByteSize(file.content.length),
        isPublished: file.isPublished,
        originalUploadedAt: file.originalUploadedAt,
        publicUrl: `${ request.url.origin }${ links.public }`,
        links,
    };
}

const BYTE_UNITS = [ 'bytes', 'KB', 'MB', 'GB' ];

// Local presentation formatter: no domain code needs a human-readable byte
// size, so this stays private to the admin file templates rather than
// becoming a shared template helper.
function formatByteSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '';
    }
    if (bytes === 0) {
        return '0 bytes';
    }

    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 ? 0 : 1;
    return `${ value.toFixed(precision) } ${ BYTE_UNITS[unitIndex] }`;
}

function getFileResult(context, file) {
    return {
        file,
        links: getFileActionLinks(context, file.id),
    };
}

function redirect(response, context, targetName, params, notice) {
    const pathname = context.getHttpTarget(targetName).compilePathname(params).pathname;
    return response.respondWithRedirect(303, notice ? `${ pathname }?notice=${ notice }` : pathname);
}
