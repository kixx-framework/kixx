import BaseUser from './base-user.js';

export default class RootUser extends BaseUser {
    // A root user has permission to do anything.
    hasPermission() {
        return true;
    }
}
