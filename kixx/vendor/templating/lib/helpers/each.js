/* eslint-disable no-invalid-this */

export default function each_helper(_context, _options, iterableObject) {
    if (iterableObject === null || typeof iterableObject !== 'object') {
        return this.renderInverse();
    }

    const [ itemName, indexName ] = this.blockParams;

    if (!itemName) {
        throw new Error('The first block param |[itemName]| is required for the #each helper');
    }

    if (Array.isArray(iterableObject)) {
        if (iterableObject.length === 0) {
            return this.renderInverse();
        }

        const subContext = {};
        let str = '';

        for (let index = 0; index < iterableObject.length; index += 1) {
            const item = iterableObject[index];
            subContext[itemName] = item;
            if (indexName) {
                subContext[indexName] = index;
            }

            str += this.renderPrimary(subContext);
        }

        return str;
    }

    const objectTag = Object.prototype.toString.call(iterableObject);

    if (objectTag === '[object Map]') {
        if (iterableObject.size === 0) {
            return this.renderInverse();
        }

        const subContext = {};
        let str = '';

        for (const [ key, val ] of iterableObject) {
            subContext[itemName] = val;
            if (indexName) {
                subContext[indexName] = key;
            }

            str += this.renderPrimary(subContext);
        }

        return str;
    }

    if (objectTag === '[object Set]') {
        if (iterableObject.size === 0) {
            return this.renderInverse();
        }

        const subContext = {};
        let str = '';

        for (const val of iterableObject) {
            subContext[itemName] = val;
            str += this.renderPrimary(subContext);
        }

        return str;
    }

    const keys = Object.keys(iterableObject);

    if (keys.length === 0) {
        return this.renderInverse();
    }

    const subContext = {};
    let str = '';

    for (const key of keys) {
        subContext[itemName] = iterableObject[key];
        if (indexName) {
            subContext[indexName] = key;
        }

        str += this.renderPrimary(subContext);
    }

    return str;
}
