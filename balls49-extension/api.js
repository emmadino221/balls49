// Route API calls through the extension worker, not the game's page origin.
async function extensionFetch(input, options = {}) {
    const url = new URL(input);
    url.searchParams.delete('key');
    const reply = await chrome.runtime.sendMessage({
        type: 'BALLS49_API',
        path: url.pathname,
        query: url.searchParams.toString(),
        method: options.method || 'GET',
        body: options.body
    });
    if (!reply || reply.error) throw new Error(reply?.error || 'Bot connection unavailable.');
    return new Response(reply.body, {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' }
    });
}
