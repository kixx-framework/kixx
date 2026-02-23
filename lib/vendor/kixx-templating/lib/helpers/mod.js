import each_helper from './each.js';
import if_helper from './if.js';
import unless_helper from './unless.js';
import ifequal_helper from './if-equal.js';
import with_helper from './with.js';
import unescape_helper from './unescape.js';
import plusone_helper from './plus-one.js';


export default new Map([
    [ 'each', each_helper ],
    [ 'if', if_helper ],
    [ 'unless', unless_helper ],
    [ 'ifEqual', ifequal_helper ],
    [ 'with', with_helper ],
    [ 'unescape', unescape_helper ],
    [ 'plusOne', plusone_helper ],
]);
