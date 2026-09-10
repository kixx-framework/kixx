import { BadRequestError, NotFoundError } from '../../../../kixx/errors/mod.js';
import FileActionForm from '../../forms/files/file-action-form.js';
import FileMetadataForm from '../../forms/files/file-metadata-form.js';
import UploadFileForm from '../../forms/files/upload-file-form.js';
import { validateCsrfFormData, validateCsrfHeader } from '../../lib/csrf.js';
import { createFile } from '../../../transaction-scripts/files/create-file.js';
import { deleteFile } from '../../../transaction-scripts/files/delete-file.js';
import { getFile } from '../../../transaction-scripts/files/get-file.js';
import { listFiles } from '../../../transaction-scripts/files/list-files.js';
import { publishFile } from '../../../transaction-scripts/files/publish-file.js';
import { replaceFile } from '../../../transaction-scripts/files/replace-file.js';
import { unpublishFile } from '../../../transaction-scripts/files/unpublish-file.js';
import { updateFileMetadata } from '../../../transaction-scripts/files/update-file-metadata.js';

/** Loads the admin file listing for Hyperview rendering. */
export async function getAdminFiles(context, request, response) {
    const page = await listFiles(context, request.queryParams.cursor);
    return response.updateProps({ files: page });
}

/** Loads one file for the admin detail page. */
export async function getAdminFile(context, request, response) {
    const form = makeActionForm(request);
    form.validate();
    const file = await getFile(context, form.fileId);
    if (!file) {
        throw new NotFoundError('File was not found', { code: 'FileNotFound' });
    }
    return response.updateProps({ file });
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
    const file = await updateFileMetadata(context, action.fileId, FileMetadataForm.fromFormData(formData));
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

/** Permanently deletes an unpublished file. */
export async function postFileDelete(context, request, response) {
    await validateCsrfFormData(context, request);
    const file = await deleteFile(context, validatedAction(request));
    if (request.headers.get('kixx-partial')) {
        return response.respondWithJSON(200, { file, deleted: true });
    }
    return redirect(response, context, 'admin-panel/files/render-list');
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
    return redirect(response, context, 'admin-panel/file-detail/render-detail', file);
}

function getFileResult(context, file) {
    return {
        file,
        links: {
            detail: context.getHttpTarget('admin-panel/file-detail/render-detail').compilePathname({ fileId: file.id }).pathname,
            download: context.getHttpTarget('admin-panel/file-download/download').compilePathname({ fileId: file.id }).pathname,
            public: context.getHttpTarget('files/download').compilePathname({ fileId: file.id }).pathname,
        },
    };
}

function redirect(response, context, targetName, params) {
    return response.respondWithRedirect(303, context.getHttpTarget(targetName).compilePathname(params).pathname);
}
