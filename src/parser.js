const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { matchEndDFN, matchEndIDL, matchStartDFN, matchStartIDL } = require('./regex.js');
const { assert } = require('./util.js');
const { parse: parseIDL } = require('webidl2');
const { convertIDL } = require('webidl2ts');

async function* readBikeshedWithIncludes(filePath) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    let processingInclude = 'no';
    for await (const line of rl) {
        switch (processingInclude) {
            case 'no': {
                if (line === '<pre class=include>') {
                    processingInclude = 'started';
                } else {
                    yield line;
                }
            } break;
            case 'started': {
                assert(line.startsWith('path: '));
                const include = path.join(path.dirname(filePath), line.slice(6));
                yield* readBikeshedWithIncludes(include);
                processingInclude = 'done';
            } break;
            case 'done': {
                assert(line === '</pre>');
                processingInclude = 'no';
            } break;
        }
    }
}

async function parseBikeshedFile(filePath) {
    const exposed = new Set();

    const dfnBlocks = new Map();
    const tsBlocks = new Map();

    let idlRecording = null;
    let dfnRecording = null;

    for await (const line of readBikeshedWithIncludes(filePath)) {
        /* DFN Matching */
        const dfnMatch = matchStartDFN(line);
        if (dfnMatch) {
            dfnRecording = {
                target: dfnMatch[2],
                type: dfnMatch[1],
                lines: [],
            }
            continue;
        }

        if (dfnRecording && matchEndDFN(line)) {
            if (!dfnBlocks.has(dfnRecording.target)) {
                dfnBlocks.set(dfnRecording.target, []);
            }
            dfnBlocks.get(dfnRecording.target).push(dfnRecording);
            dfnRecording = null;
            continue;
        }

        if (dfnRecording) {
            dfnRecording.lines.push(line);
            continue;
        }

        /* IDL Matching */
        if (matchStartIDL(line)) {
            idlRecording = [];
            continue;
        }

        if (idlRecording && matchEndIDL(line)) {
            const idlText = idlRecording.join('\n');
            idlRecording = null;

            const idlBlock = parseIDL(idlText);
            for (const idlNode of idlBlock) {
                if (isExposed(idlNode)) {
                    exposed.add(idlNode.name);
                }
            }

            const tsNodes = convertIDL(idlBlock, {});
            for (let i = 0, n = tsNodes.length; i < n; ++i) {
                const node = tsNodes[i];
                if (node.name) {
                    node.__idl = idlBlock.filter(idl => (idl.name || idl.target) === node.name.escapedText);
                    if (!tsBlocks.has(node.name.escapedText)) {
                        tsBlocks.set(node.name.escapedText, []);
                    }
                    tsBlocks.get(node.name.escapedText).push(node);
                }
            }
            continue;
        }

        if (idlRecording) {
            idlRecording.push(line);
        }
    }

    return {
        dfn: dfnBlocks,
        ts: tsBlocks,
        exposed,
    };
}

function isExposed(idlNode) {
    if (idlNode.extAttrs.length) {
        for (const attr of idlNode.extAttrs) {
            if (attr.name === 'Exposed') {
                return true;
            }
        }
    }
    return false;
}

module.exports = {
    parseBikeshedFile,
    isExposed,
};
