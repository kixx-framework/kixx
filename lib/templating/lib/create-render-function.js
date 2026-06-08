import LineSyntaxError from './line-syntax-error.js';
import { escapeHTMLChars } from './utils.js';


// Phase 1 engine: a closure-composition renderer over a zero-copy context stack.
//
// Compilation walks the AST once and emits a tree of pre-bound closures. Rendering
// then calls those closures over a stack of "frames" ({ value, parent }) instead of
// copying the context object at every scope change. The same frame stack provides
// Mustache's upward name resolution.
export default function createRenderFunction(options, helpers, partials, tree) {

    // The escape policy is pluggable: callers can pass a stricter escape function
    // via options.escape. The default escapes the Mustache spec set (& < > ").
    const escapeFunction = options && typeof options.escape === 'function'
        ? options.escape
        : escapeHTMLChars;

    const renderRoot = compileNodes(tree);

    function render(data) {
        return renderRoot({ value: data, parent: null });
    }

    // Partials inherit the caller's full frame stack. Exposing the frame-accepting
    // renderer lets a {{> partial}} render against the current stack rather than a
    // fresh root.
    render.renderWithFrame = renderRoot;
    render.renderWithFrameAndIndent = renderRoot.renderIndented;

    return render;

    // --- Compilation -------------------------------------------------------

    function compileNodes(nodes) {
        const steps = [];
        let pendingContent = '';
        let pendingContentStartsLine = false;

        function flushContent() {
            if (pendingContent) {
                const str = pendingContent;
                const startsLine = pendingContentStartsLine;

                steps.push(function renderContent() {
                    return str;
                });
                steps[steps.length - 1].renderIndented = function renderIndentedContent(_frame, indent) {
                    return indentContent(str, indent, startsLine);
                };

                pendingContent = '';
                pendingContentStartsLine = false;
            }
        }

        for (const node of nodes) {
            // Coalesce adjacent literal content into a single step.
            if (node.type === 'CONTENT') {
                if (!pendingContent) {
                    pendingContentStartsLine = node.tokens[0] ? node.tokens[0].startPosition === 0 : false;
                }
                pendingContent += node.str;
                continue;
            }
            // Comments, block-close markers, and stray else markers emit nothing.
            if (node.type === 'COMMENT' || node.type === 'SET_DELIMITERS' || node.type === 'BLOCK_CLOSE' || node.type === 'ELSE') {
                continue;
            }

            flushContent();
            const step = compileNode(node);
            if (step) {
                steps.push(step);
            }
        }

        flushContent();

        if (steps.length === 0) {
            return noopRender;
        }
        if (steps.length === 1) {
            return steps[0];
        }

        function renderSteps(frame) {
            let out = '';
            for (let i = 0; i < steps.length; i += 1) {
                out += steps[i](frame);
            }
            return out;
        }

        renderSteps.renderIndented = function renderIndentedSteps(frame, indent) {
            let out = '';
            for (let i = 0; i < steps.length; i += 1) {
                out += steps[i].renderIndented(frame, indent);
            }
            return out;
        };

        return renderSteps;
    }

    function compileNode(node) {
        switch (node.type) {
            case 'PATH_EXPRESSION':
            case 'HELPER_EXPRESSION':
                return compileMustache(node);
            case 'BLOCK_OPEN':
                return compileBlock(node);
            case 'PARTIAL':
                return compilePartial(node);
            default:
                return null;
        }
    }

    // A non-block mustache: a helper call (if the name is a registered helper or the
    // expression carries arguments) or a plain data interpolation.
    function compileMustache(node) {
        const exp = node.exp;
        const head = exp[0];

        if (exp.length > 1 || isHelperName(head)) {
            return compileHelper(node, false);
        }

        return compileInterpolation(node, head, node.escape !== false);
    }

    function compileInterpolation(node, sub, escape) {
        const path = pathForHead(sub);
        let render;

        // A genuine literal in name position (a quoted string or a number) renders
        // its value directly.
        if (!path) {
            const value = escape ? escapeFunction(sub.value) : coerce(sub.value);
            render = function renderLiteral() {
                return value;
            };
            return withIndentedLinePrefix(render, node);
        }

        if (escape) {
            render = function renderEscaped(frame) {
                return escapeFunction(lookup(frame, path));
            };
            return withIndentedLinePrefix(render, node);
        }

        render = function renderUnescaped(frame) {
            return coerce(lookup(frame, path));
        };
        return withIndentedLinePrefix(render, node);
    }

    function compileBlock(node) {
        const head = node.exp[0];
        const inverted = node.inverted === true;

        // Inverted sections ({{^x}}) are always data-driven. A regular {{#x}} is a
        // helper call when x is a registered helper or arguments are present.
        if (!inverted && (node.exp.length > 1 || isHelperName(head))) {
            return compileHelper(node, true);
        }

        const path = pathForHead(head) || [];
        const program = compileNodes(node.children || []);

        function renderInvertedSection(frame) {
            return renderInvertedSectionWith(frame, program);
        }

        function renderSection(frame) {
            return renderSectionWith(frame, program);
        }

        if (inverted) {
            renderInvertedSection.renderIndented = function renderIndentedInvertedSection(frame, indent) {
                return prefixIndentedLine(renderInvertedSectionWith(frame, program.renderIndented, indent), node, indent);
            };

            return renderInvertedSection;
        }

        renderSection.renderIndented = function renderIndentedSection(frame, indent) {
            return prefixIndentedLine(renderSectionWith(frame, program.renderIndented, indent), node, indent);
        };

        return renderSection;

        function renderInvertedSectionWith(frame, renderProgram, indent) {
            if (isSectionFalsey(lookup(frame, path))) {
                return indent ? renderProgram(frame, indent) : renderProgram(frame);
            }
            return '';
        }

        function renderSectionWith(frame, renderProgram, indent) {
            const value = lookup(frame, path);

            if (isSectionFalsey(value)) {
                return '';
            }

            if (Array.isArray(value)) {
                let out = '';
                for (let i = 0; i < value.length; i += 1) {
                    const childFrame = { value: value[i], parent: frame };
                    out += indent ? renderProgram(childFrame, indent) : renderProgram(childFrame);
                }
                return out;
            }

            if (isMap(value)) {
                let out = '';
                for (const item of value.values()) {
                    const childFrame = { value: item, parent: frame };
                    out += indent ? renderProgram(childFrame, indent) : renderProgram(childFrame);
                }
                return out;
            }

            if (isSet(value)) {
                let out = '';
                for (const item of value) {
                    const childFrame = { value: item, parent: frame };
                    out += indent ? renderProgram(childFrame, indent) : renderProgram(childFrame);
                }
                return out;
            }

            if (isPlainObject(value)) {
                let out = '';
                const keys = Object.keys(value);
                for (let i = 0; i < keys.length; i += 1) {
                    const childFrame = { value: value[keys[i]], parent: frame };
                    out += indent ? renderProgram(childFrame, indent) : renderProgram(childFrame);
                }
                return out;
            }

            const childFrame = { value, parent: frame };
            return indent ? renderProgram(childFrame, indent) : renderProgram(childFrame);
        }
    }

    function compileHelper(node, isBlock) {
        const head = node.exp[0];
        const helperName = head.path[0];
        const helperFunction = helpers.get(helperName);
        const openToken = node.tokens[0];

        if (!helperFunction) {
            throw new LineSyntaxError(
                `No helper named "${ helperName }" in "${ openToken.filename }" on line ${ openToken.lineNumber }`,
                openToken,
            );
        }

        const positionalArguments = [];
        const namedArguments = [];
        let blockParams = [];

        for (const t of node.exp.slice(1)) {
            switch (t.type) {
                case 'PATH':
                case 'LITERAL':
                    positionalArguments.push(compileArgument(t));
                    break;
                case 'KEY_VALUE':
                    namedArguments.push([ t.key, compileArgument(t.value) ]);
                    break;
                case 'BLOCK_PARAMS':
                    blockParams = t.params;
                    break;
            }
        }

        let currentFrame = null;
        let currentIndent = null;

        let renderPrimary = noopRender;
        let renderInverse = noopRender;

        if (isBlock && node.children && node.children.length > 0) {
            const primaryNodes = [];
            const inverseNodes = [];
            let inElse = false;

            for (const child of node.children) {
                if (child.type === 'BLOCK_CLOSE') {
                    continue;
                }
                if (child.type === 'ELSE') {
                    inElse = true;
                    continue;
                }
                (inElse ? inverseNodes : primaryNodes).push(child);
            }

            if (primaryNodes.length > 0) {
                renderPrimary = compileNodes(primaryNodes);
            }
            if (inverseNodes.length > 0) {
                renderInverse = compileNodes(inverseNodes);
            }
        }

        const thisHelperContext = {
            blockParams,

            renderPrimary(newData) {
                return renderHelperBlock(renderPrimary, newData);
            },

            renderInverse(newData) {
                return renderHelperBlock(renderInverse, newData);
            },
        };

        function renderHelper(frame) {
            return invokeHelper(frame);
        }

        renderHelper.renderIndented = function renderIndentedHelper(frame, indent) {
            return prefixIndentedLine(invokeHelper(frame, indent), node, indent);
        };

        return renderHelper;

        function invokeHelper(frame, indent) {
            const previousFrame = currentFrame;
            const previousIndent = currentIndent;
            currentFrame = frame;
            currentIndent = indent;

            try {
                return invokeHelperFunction(frame, createNamedArgs(frame));
            } catch (cause) {
                const errorData = Object.assign({ cause }, openToken);
                throw new LineSyntaxError(
                    `Error in helper "${ helperName }" in "${ openToken.filename }" on line ${ openToken.lineNumber }`,
                    errorData,
                );
            } finally {
                currentFrame = previousFrame;
                currentIndent = previousIndent;
            }
        }

        function invokeHelperFunction(frame, namedArgs) {
            switch (positionalArguments.length) {
                case 0:
                    return helperFunction.call(thisHelperContext, frame.value, namedArgs);
                case 1:
                    return helperFunction.call(
                        thisHelperContext,
                        frame.value,
                        namedArgs,
                        resolveCompiledArgument(positionalArguments[0], frame),
                    );
                case 2:
                    return helperFunction.call(
                        thisHelperContext,
                        frame.value,
                        namedArgs,
                        resolveCompiledArgument(positionalArguments[0], frame),
                        resolveCompiledArgument(positionalArguments[1], frame),
                    );
                case 3:
                    return helperFunction.call(
                        thisHelperContext,
                        frame.value,
                        namedArgs,
                        resolveCompiledArgument(positionalArguments[0], frame),
                        resolveCompiledArgument(positionalArguments[1], frame),
                        resolveCompiledArgument(positionalArguments[2], frame),
                    );
                default:
                    return helperFunction.call(
                        thisHelperContext,
                        frame.value,
                        namedArgs,
                        ...createPositionalArgs(frame),
                    );
            }
        }

        function createPositionalArgs(frame) {
            const args = new Array(positionalArguments.length);
            for (let i = 0; i < positionalArguments.length; i += 1) {
                args[i] = resolveCompiledArgument(positionalArguments[i], frame);
            }
            return args;
        }

        function createNamedArgs(frame) {
            const args = {};
            for (let i = 0; i < namedArguments.length; i += 1) {
                const [ key, arg ] = namedArguments[i];
                args[key] = resolveCompiledArgument(arg, frame);
            }
            return args;
        }

        function renderHelperBlock(renderBlock, newData) {
            const frame = typeof newData === 'undefined'
                ? currentFrame
                : { value: newData, parent: currentFrame };

            return currentIndent ? renderBlock.renderIndented(frame, currentIndent) : renderBlock(frame);
        }
    }

    function compilePartial(node) {
        const partialName = node.exp;

        function renderPartial(frame) {
            if (typeof node.indentation === 'string') {
                return renderPartialWithIndent(frame, node.indentation);
            }
            return renderPartialWithoutIndent(frame);
        }

        renderPartial.renderIndented = function renderIndentedPartial(frame, indent) {
            if (typeof node.indentation === 'string') {
                return renderPartialWithIndent(frame, indent + node.indentation);
            }
            return prefixIndentedLine(renderPartialWithoutIndent(frame), node, indent);
        };

        return renderPartial;

        function renderPartialWithoutIndent(frame) {
            // Per the Mustache spec, a missing partial renders as an empty string.
            if (!partials.has(partialName)) {
                return '';
            }

            const partial = partials.get(partialName);
            if (typeof partial.renderWithFrame === 'function') {
                return partial.renderWithFrame(frame);
            }
            return partial(frame.value);
        }

        function renderPartialWithIndent(frame, indentation) {
            if (!partials.has(partialName)) {
                return '';
            }

            const partial = partials.get(partialName);
            if (typeof partial.renderWithFrameAndIndent === 'function') {
                return partial.renderWithFrameAndIndent(frame, indentation);
            }
            return indentRenderedOutput(partial(frame.value), indentation);
        }
    }

    // --- Runtime helpers ---------------------------------------------------

    function isHelperName(sub) {
        return sub.type === 'PATH' && sub.path.length === 1 && helpers.has(sub.path[0]);
    }

    // Mustache name resolution: search the frame stack for the first frame whose
    // value carries the first path segment, then resolve the remaining segments
    // directly on that value (broken chains do not re-search the stack). An empty
    // path is the implicit iterator: the current frame's value.
    function lookup(frame, segments) {
        return lookupFrame(frame, segments);
    }
}


// The resolvable path for an expression's head/name. PATH sub-tokens carry their
// segments directly; a keyword literal (true/false/null/undefined) in name position
// is treated as a single-segment property path. A genuine literal returns null.
function pathForHead(sub) {
    if (sub.type === 'PATH') {
        return sub.path;
    }
    if (sub.type === 'LITERAL' && typeof sub.keyword === 'string') {
        return [ sub.keyword ];
    }
    return null;
}

function compileArgument(arg) {
    if (arg.type === 'LITERAL') {
        return { value: arg.value };
    }
    return { path: arg.path };
}

function resolveCompiledArgument(arg, frame) {
    if (Object.prototype.hasOwnProperty.call(arg, 'value')) {
        return arg.value;
    }
    return lookupFrame(frame, arg.path);
}

function hasKey(value, key) {
    if (Array.isArray(value) && typeof key === 'number') {
        return key >= 0 && key < value.length;
    }
    return Object.prototype.hasOwnProperty.call(value, key);
}

function lookupFrame(frame, segments) {
    if (segments.length === 0) {
        return frame ? frame.value : undefined;
    }

    const first = segments[0];
    let container;

    for (let f = frame; f; f = f.parent) {
        const value = f.value;
        if (value !== null && typeof value === 'object' && hasKey(value, first)) {
            container = value;
            break;
        }
    }

    if (container === undefined) {
        return undefined;
    }

    let current = container[first];
    for (let i = 1; i < segments.length; i += 1) {
        if (current === null || typeof current === 'undefined') {
            return undefined;
        }
        current = current[segments[i]];
    }
    return current;
}

function isSectionFalsey(value) {
    if (value === false || value === null || typeof value === 'undefined') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (isMap(value) || isSet(value)) {
        return value.size === 0;
    }
    if (isPlainObject(value)) {
        return Object.keys(value).length === 0;
    }
    return false;
}

function isMap(value) {
    return Object.prototype.toString.call(value) === '[object Map]';
}

function isSet(value) {
    return Object.prototype.toString.call(value) === '[object Set]';
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function coerce(value) {
    if (value === null || typeof value === 'undefined') {
        return '';
    }
    return typeof value === 'string' ? value : String(value);
}

function withIndentedLinePrefix(render, node) {
    render.renderIndented = function renderIndentedWithLinePrefix(frame, indent) {
        return prefixIndentedLine(render(frame), node, indent);
    };
    return render;
}

function prefixIndentedLine(str, node, indent) {
    if (!indent || !nodeStartsIndentedLine(node)) {
        return str;
    }
    return indent + str;
}

function nodeStartsIndentedLine(node) {
    return node && !node.standalone && node.openToken && node.openToken.startPosition === 0;
}

function indentContent(str, indent, startsLine) {
    if (!indent || str.length === 0) {
        return str;
    }

    let out = startsLine ? indent : '';

    for (let i = 0; i < str.length; i += 1) {
        out += str[i];
        if (str[i] === '\n' && i < str.length - 1) {
            out += indent;
        }
    }

    return out;
}

function indentRenderedOutput(str, indent) {
    return indentContent(str, indent, true);
}

function noopRender() {
    return '';
}

noopRender.renderIndented = noopRender;
