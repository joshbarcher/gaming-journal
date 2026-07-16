/**
 * sectionize — convert a flat ContentBlock[] into a nested section tree.
 *
 * Adapter-agnostic: any source that emits flat blocks gets the same structure.
 *
 * Input (flat):
 *   [heading(2), paragraph, heading(3), list, heading(3), table, ...]
 *
 * Output (nested):
 *   [
 *     { type:'section', level:2, heading:'...', id:'...', children:[
 *         paragraph,
 *         { type:'section', level:3, heading:'...', id:'...', children:[list] },
 *         { type:'section', level:3, heading:'...', id:'...', children:[table] },
 *     ]}
 *   ]
 *
 * Blocks that appear before the first heading are placed at the root level.
 */

export function sectionize(blocks) {
    const root  = [];
    const stack = []; // open section nodes, ordered by nesting depth

    function currentChildren() {
        return stack.length ? stack[stack.length - 1].children : root;
    }

    for (const block of blocks) {
        if (block.type === 'heading') {
            // Close any open sections that are at the same level or deeper
            while (stack.length && stack[stack.length - 1].level >= block.level) {
                stack.pop();
            }

            const section = {
                type:     'section',
                level:    block.level,
                heading:  block.text,
                id:       headingId(block.text),
                children: [],
            };

            currentChildren().push(section);
            stack.push(section);
        } else {
            currentChildren().push(block);
        }
    }

    return root;
}

/**
 * Flatten a section tree back to a list of {id, heading, level} entries.
 * Used to build in-page outlines.
 */
export function extractOutline(nodes) {
    const outline = [];
    function walk(items) {
        for (const node of items) {
            if (node.type === 'section') {
                outline.push({ id: node.id, heading: node.heading, level: node.level });
                walk(node.children);
            }
        }
    }
    walk(nodes);
    return outline;
}

export function headingId(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
