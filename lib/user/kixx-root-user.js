// TODO: Remove this file
import KixxBaseUser from './kixx-base-user.js';

export default class KixxRootUser extends KixxBaseUser {
    hasPermission() {
        // The Root User has permission to do anything they want.
        return true;
    }
}
