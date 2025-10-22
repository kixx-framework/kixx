import User from './user.model.js';

export default class RootUser extends User {
    hasPermission() {
        // The Root User has permission to do anything they want.
        return true;
    }
}
