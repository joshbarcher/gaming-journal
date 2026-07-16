/**
 * Like Promise.all(items.map(fn)) but processes at most `concurrency` items
 * at a time. Prevents EMFILE on network shares when mapping over large file lists.
 */
export async function mapChunked(items, fn, concurrency = 20) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const chunk = await Promise.all(items.slice(i, i + concurrency).map(fn));
        results.push(...chunk);
    }
    return results;
}
