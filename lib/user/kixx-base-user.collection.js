import KixxBaseUser from './kixx-base-user.js';
import KixxBaseCollection from '../models/kixx-base-collection.js';

export default class KixxBaseUserCollection extends KixxBaseCollection {

    // Subclasses can override the base type.
    static Model = KixxBaseUser;

    constructor(context) {
        super(context);
    }
}
