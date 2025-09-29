import { AssertionError } from '../../assertions/mod.js';
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

    return async function queryView(context, request, response) {
        const { user } = request;

        const params = deepMerge(
            {},
            options.params,
            request.hostnameParams,
            request.pathnameParams,
            request.queryParams
        );

        const props = {};
        const propName = options.propertyName || 'item';

        props[propName] = await user[options.method](params);

        return response.updateProps(props);
    };
}
