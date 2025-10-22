import { KixxBaseUserCollection } from 'kixx';
import User from './user.model.js';
import RootUser from './root-user.model.js';
import UserSession from './user-session.model.js';

export default class UserCollection extends KixxBaseUserCollection {
    static User = User;
    static RootUser = RootUser;
    static UserSession = UserSession;
}
