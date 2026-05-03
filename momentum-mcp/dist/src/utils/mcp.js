export function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
export function fail(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: msg }], isError: true };
}
