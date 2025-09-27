import { AssertionError, assertNonEmptyString } from '../../assertions/mod.js';
import deepMerge from '../../lib/deep-merge.js';


const availableMethods = [
    'getItem',
];

const METHODS = new Set(availableMethods);


export default function QueryView(options) {
    options = options || {};

    if (!METHODS.has(options.method)) {
        throw new AssertionError(
            `View method "${ options.method }" does not exist. Available methods are "${ availableMethods.join('", "') }"`
        );
    }

    assertNonEmptyString(options.propertyName, 'A return property name must be provided to the QueryView handler');

    return async function queryView(context, request, response) {
        // TODO: We should authenticating a user or anonymous user.
        const user = context.rootUser;

        const params = deepMerge(
            {},
            options.params,
            request.hostnameParams,
            request.pathnameParams,
            request.queryParams
        );

        const props = {};

        props[options.propertyName] = await user[options.method](params);

        return response.updateProps(props);
    };
}
