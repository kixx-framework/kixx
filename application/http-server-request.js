import BaseServerRequest from '../http-server/base-server-request.js';


export default class HttpServerRequest extends BaseServerRequest {

    isRequestForJSON() {
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }
        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }
        return false;
    }
}
