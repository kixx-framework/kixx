import each_helper from './each.js';
import ifempty_helper from './if-empty.js';
import ifequal_helper from './if-equal.js';
import if_helper from './if.js';
import noop_helper from './noop.js';


export default new Map([
    [ 'each', each_helper ],
    [ 'if', if_helper ],
    [ 'ifEmpty', ifempty_helper ],
    [ 'ifEqual', ifequal_helper ],
    [ 'noop', noop_helper ],
]);
