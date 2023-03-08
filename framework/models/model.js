// @ts-check

import { mergeDeep } from 'kixx-lib-es6';

export default class Model {

    static type = 'model';
    static includedAttributes = null;

    /**
     * @type {String}
     */
    scope;

    /**
     * @type {String}
     */
    type;

    /**
     * @type {String}
     */
    id;

    /**
     * @type {String}
     */
    created;

    /**
     * @type {String}
     */
    updated;

    /**
     * @type {Object}
     */
    relationships = {};

    constructor(spec) {
        Object.assign(this, spec);
    }

    mergeAttributes(attributes) {
        const SubClass = this.constructor;
        const spec = mergeDeep({}, this, attributes);

        // @ts-ignore error TS2351: This expression is not constructable.
        return new SubClass(spec);
    }

    mergeRelationships(relationships) {
        const SubClass = this.constructor;

        function addNewRelationships(existingRelationships, newRelationships) {
            if (!Array.isArray(existingRelationships) || existingRelationships.length === 0) {
                return newRelationships;
            }

            newRelationships.forEach((relationship) => {
                const existing = existingRelationships.find(({ type, id }) => {
                    return relationship.type === type && relationship.id === id;
                });

                if (existing) {
                    mergeDeep(existing, relationship);
                } else {
                    existingRelationships.push(relationship);
                }
            });

            return existingRelationships;
        }

        const rel = Object.keys(relationships).reduce((related, key) => {
            related[key] = addNewRelationships(this.relationships[key], relationships[key]);
            return related;
        }, {});

        const spec = Object.assign({}, this, { relationships: rel });

        // @ts-ignore error TS2351: This expression is not constructable.
        return new SubClass(spec);
    }

    validate() {
        return null;
    }

    validateNew() {
        return null;
    }

    toJSON() {
        const SubClass = this.constructor;

        // @ts-ignore error TS2339: Property 'type' does not exist on type 'Function'
        // @ts-ignore error TS2339: Property 'includedAttributes' does not exist on type 'Function'
        const { type, includedAttributes } = SubClass;

        const keys = Array.isArray(includedAttributes) ? includedAttributes : Object.keys(this);

        const spec = keys.reduce((target, key) => {
            target[key] = structuredClone(this[key]);
            return target;
        }, {});

        spec.scope = this.scope;
        spec.type = type;
        spec.id = this.id;
        spec.created = this.created;
        spec.updated = this.updated;
        spec.relationships = this.relationships || {};

        return spec;
    }

    static fromAttributes(attributes) {
        const SubClass = this;

        const spec = structuredClone(attributes);

        spec.scope = attributes.scope;
        spec.type = SubClass.type;
        spec.id = attributes.id;
        spec.relationships = attributes.relationships || {};
        spec.created = attributes.created;
        spec.updated = attributes.updated;

        return new SubClass(spec);
    }

    static fromDatabaseRecord(record) {
        const SubClass = this;

        const spec = structuredClone(record);

        spec.scope = record.scope;
        spec.type = SubClass.type;
        spec.id = record.id;
        spec.relationships = record.relationships || {};
        spec.created = record.created;
        spec.updated = record.updated;

        return new SubClass(spec);
    }
}
