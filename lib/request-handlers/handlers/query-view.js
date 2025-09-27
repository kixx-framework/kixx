import { assertNonEmptyString } from '../../assertions/mod.js';
import deepMerge from '../../lib/deep-merge.js';


export default function QueryView(options) {
    options = options || {};

    // TODO: We need to assert that the method belongs to the enum of accepted methods.
    assertNonEmptyString(options.method);

    assertNonEmptyString(options.propertyName);

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
