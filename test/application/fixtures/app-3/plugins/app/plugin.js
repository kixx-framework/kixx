// This import will break, for testing.
import Foo from '../foo.js';

export function register(context) {
    context.registerService('Foo', new Foo());
}

export function initialize() {
}
