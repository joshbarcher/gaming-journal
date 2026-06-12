export function parseListItems(ul) {
    const items = []
    function walk(el, depth) {
        for (const child of el.children) {
            if (child.tagName === 'LI') {
                const clone = child.cloneNode(true)
                for (const nested of Array.from(clone.querySelectorAll('ul, ol'))) {
                    nested.remove()
                }
                items.push({ depth, html: clone.innerHTML })
                for (const nested of child.children) {
                    if (nested.tagName === 'UL' || nested.tagName === 'OL') {
                        walk(nested, depth + 1)
                    }
                }
            } else if (child.tagName === 'UL' || child.tagName === 'OL') {
                walk(child, depth + 1)
            }
        }
    }
    walk(ul, 0)
    return items
}

export function applyIndent(items, startIdx, endIdx, outdent) {
    if (startIdx < 0 || startIdx >= items.length) return items
    const result = items.map(item => ({ ...item }))
    const last = Math.min(endIdx, items.length - 1)
    for (let idx = startIdx; idx <= last; idx++) {
        result[idx].depth = outdent
            ? Math.max(0, result[idx].depth - 1)
            : result[idx].depth + 1
    }
    return result
}

export function renderListItems(items, tag) {
    if (!items.length) return ''
    let i = 0
    function render(depth) {
        let html = ''
        while (i < items.length) {
            const d = items[i].depth
            if (d < depth) break
            if (d === depth) {
                const { html: content } = items[i++]
                let children = ''
                if (i < items.length && items[i].depth > depth) {
                    children = `<${tag}>${render(depth + 1)}</${tag}>`
                }
                html += `<li>${content}${children}</li>`
            } else {
                html += `<${tag}>${render(d)}</${tag}>`
            }
        }
        return html
    }
    const minDepth = items.reduce((m, it) => Math.min(m, it.depth), Infinity)
    return render(minDepth)
}
