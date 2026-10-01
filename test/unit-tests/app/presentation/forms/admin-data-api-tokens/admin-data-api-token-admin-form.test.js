import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import AdminDataApiTokenCreateForm, {
    AdminDataApiTokenRevokeForm,
    DEFAULT_ADMIN_DATA_API_TOKEN_TTL_SECONDS,
    MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS,
} from '../../../../../../src/app/presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function fieldErrors(form) {
    const error = catchError(() => form.validate());
    return error ? error.errors.map(({ source }) => source) : [];
}


describe('admin-data-api-token-admin-form', ({ describe }) => {

    describe('AdminDataApiTokenCreateForm', ({ describe, it }) => {

        it('reads every checked grant from FormData', () => {
            const formData = new FormData();
            formData.append('description', '  CI exporter  ');
            formData.append('grants', 'File:list');
            formData.append('grants', 'File:get');
            formData.append('time_to_live_seconds', String(60 * 60 * 24 * 7));

            const form = AdminDataApiTokenCreateForm.fromFormData(formData);
            form.validate();

            assertEqual('CI exporter', form.description);
            assertEqual('File:list,File:get', form.grants.join());
            assertEqual(60 * 60 * 24 * 7, form.time_to_live_seconds);
        });

        it('defaults the lifetime and accepts a single grant string', () => {
            const form = new AdminDataApiTokenCreateForm({ grants: 'File:get' });
            form.validate();

            assertEqual(DEFAULT_ADMIN_DATA_API_TOKEN_TTL_SECONDS, form.time_to_live_seconds);
            assertEqual(null, form.description);
        });

        it('groups grants by Collection for the transaction script', () => {
            const form = new AdminDataApiTokenCreateForm({ grants: [ 'File:get', 'File:update', 'File:get' ] });
            form.validate();

            const json = form.toJSON();

            assertEqual(1, json.grants.length);
            assertEqual('File', json.grants[0].collection);
            assertEqual('get,update', json.grants[0].actions.join());
        });

        describe('validation', ({ it }) => {
            it('requires at least one grant', () => {
                assertEqual('grants', fieldErrors(new AdminDataApiTokenCreateForm({})).join());
                assertEqual('grants', fieldErrors(new AdminDataApiTokenCreateForm({ grants: [] })).join());
            });

            it('rejects grants outside the registry', () => {
                for (const grant of [ 'FileContent:get', 'File:run', 'File', 'File:get:extra', '*:get', 42 ]) {
                    const form = new AdminDataApiTokenCreateForm({ grants: [ 'File:get', grant ] });
                    assertEqual('grants', fieldErrors(form).join(), `grant ${ grant }`);
                }
            });

            it('bounds the lifetime', () => {
                for (const ttl of [ '0', 'abc', '604800abc', String(MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS + 1) ]) {
                    const form = new AdminDataApiTokenCreateForm({ grants: 'File:get', time_to_live_seconds: ttl });
                    assertEqual('time_to_live_seconds', fieldErrors(form).join(), `ttl ${ ttl }`);
                }
            });

            it('bounds the description length', () => {
                const form = new AdminDataApiTokenCreateForm({ grants: 'File:get', description: 'x'.repeat(201) });
                assertEqual('description', fieldErrors(form).join());
            });
        });

        it('offers grant choices from the registry and marks selections', () => {
            const form = new AdminDataApiTokenCreateForm({ grants: [ 'File:list' ] });

            const { grants } = form.getDynamicFieldMetadata({});
            const [ files ] = grants.resources;

            assertEqual('files', files.type);
            assertEqual('list,get,create,update,delete', files.actions.map((option) => option.action).join());
            assertEqual('File:list', files.actions[0].value);
            assertEqual(true, files.actions[0].isChecked);
            assertEqual(false, files.actions[1].isChecked);
        });
    });

    describe('AdminDataApiTokenRevokeForm', ({ it }) => {
        it('requires a token id', () => {
            assertEqual('token_id', fieldErrors(new AdminDataApiTokenRevokeForm({})).join());
        });

        it('accepts and trims a stored token hash', () => {
            const tokenId = '0123456789abcdef'.repeat(4);
            const form = new AdminDataApiTokenRevokeForm({ token_id: ` ${ tokenId } ` });
            form.validate();
            assertEqual(tokenId, form.token_id);
        });

        it('rejects malformed hashes and control characters', () => {
            for (const tokenId of [ 'abc', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64),
                'g'.repeat(64), 'invalid\u0000id', `${ 'a'.repeat(63) }\u0001` ]) {
                const error = catchError(() => new AdminDataApiTokenRevokeForm({ token_id: tokenId }).validate());
                assert(error);
                assertEqual('ValidationError', error.name);
                assertEqual('token_id', error.errors[0].source);
            }
        });
    });

});
