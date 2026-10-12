import BaseForm from '../base-form.js';

/**
 * Carries the CSRF token and compiled action URL the browser upload queue
 * needs to send raw upload bodies to `POST /admin/files/upload`.
 *
 * This form is never populated from a submission: uploads travel as a raw
 * body validated by `UploadFileForm` against transport headers, not by this
 * form. It exists only so `getCsrfFormContext()` can mint a token and reverse
 * routing can compile the upload URL for the batch upload page.
 */
export default class FileUploadTransportForm extends BaseForm {

    static target = 'admin-panel/file-upload/upload';

    static method = 'POST';

    static schema = {
        type: 'object',
        properties: {},
    };
}
