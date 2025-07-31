export default class LineSyntaxError extends Error {

    name = 'LineSyntaxError';

    constructor(message, spec) {
        super(message, spec);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: 'LineSyntaxError',
            },
            message: {
                enumerable: true,
                value: message,
            },
            filename: {
                enumerable: true,
                value: spec.filename,
            },
            line: {
                enumerable: true,
                value: spec.line,
            },
            lineNumber: {
                enumerable: true,
                value: spec.lineNumber,
            },
            startPosition: {
                enumerable: true,
                value: spec.startPosition,
            },
            endPosition: {
                enumerable: true,
                value: spec.endPosition,
            },
        });
    }

    toString() {
        let lines;

        if (Number.isInteger(this.startPosition)) {
            let linePointer = '';
            const linePointerLength = this.lineNumber.toString().length + 2 + this.startPosition;

            for (let i = 0; i < linePointerLength; i += 1) {
                linePointer += '.';
            }

            linePointer += '^';

            lines = [
                `${ this.name }: ${ this.message }`,
                `${ this.lineNumber }: ${ this.line.trimEnd() }`,
                linePointer,
            ];
        } else {
            lines = [
                `${ this.name }: ${ this.message }`,
                `${ this.lineNumber }: ${ this.line.trimEnd() }`,
            ];
        }

        return lines.join('\n');
    }
}
