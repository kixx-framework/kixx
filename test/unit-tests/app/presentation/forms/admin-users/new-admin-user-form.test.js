import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import NewAdminUserForm from '../../../../../../src/app/presentation/forms/admin-users/new-admin-user-form.js';


function passwordFieldErrors(password) {
    const form = new NewAdminUserForm({
        email_address: 'admin@example.com',
        password,
        invite_token: 'invite-token',
    });

    try {
        form.validate();
    } catch (error) {
        return error.errors.filter((item) => item.source === 'password');
    }

    return [];
}

describe('NewAdminUserForm password validation', ({ it }) => {

    it('requires a password with at least 12 characters', () => {
        assertEqual(12, NewAdminUserForm.schema.properties.password.minLength);
        assertEqual('At least 12 characters.', NewAdminUserForm.schema.properties.password.hint);
        assertEqual(0, passwordFieldErrors('123456789012').length);
        assertEqual(1, passwordFieldErrors('12345678901').length);
    });

});
