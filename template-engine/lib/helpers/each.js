/* eslint-disable no-invalid-this */

export default function each_helper(context, options, iterableObject) {
    if (iterableObject === null || typeof iterableObject !== 'object') {
        return this.renderInverse(context);
    }

    const [ itemName, indexName ] = this.blockParams;

    if (!itemName) {
        throw new Error('The first block param |[itemName]| is required for the #each helper');
    }

    if (Array.isArray(iterableObject)) {
        if (iterableObject.length === 0) {
            return this.renderInverse(context);
        }

        return iterableObject.reduce((str, item, index) => {
            const subContext = {};
            subContext[itemName] = item;
            if (indexName) {
                subContext[indexName] = index;
            }

            return str + this.renderPrimary(Object.assign({}, context, subContext));
        }, '');
    }

    const objectTag = Object.prototype.toString.call(iterableObject);

    if (objectTag === '[object Map]') {
        let str = '';

        for (const [ key, val ] of iterableObject) {
            const subContext = {};
            subContext[itemName] = val;
            if (indexName) {
                subContext[indexName] = key;
            }

            str += this.renderPrimary(Object.assign({}, context, subContext));
        }

        return str;
    }

    if (objectTag === '[object Set]') {
        let str = '';

        for (const val of iterableObject) {
            const subContext = {};
            subContext[itemName] = val;
            str += this.renderPrimary(Object.assign({}, context, subContext));
        }

        return str;
    }

    return Object.keys(iterableObject).reduce((str, key) => {
        const subContext = {};
        subContext[itemName] = iterableObject[key];
        if (indexName) {
            subContext[indexName] = key;
        }

        return str + this.renderPrimary(Object.assign({}, context, subContext));
    }, '');
}
