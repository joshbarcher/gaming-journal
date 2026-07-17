// Server-side base for calling the journal's OWN /relay/* routes over loopback.
//
// SSR loaders (+page.server, +layout.server) and background service calls must
// NOT use RELAY_URL to reach gaming data: since the relay fold-in
// (docs/relay-fold-in.md) that host is a mail-only shell and 404s every
// migrated gaming route. Those calls belong to the journal itself, which serves
// all of it at /relay/api/*. RELAY_URL stays reserved for the catch-all proxy
// (routes/relay/[...path]) forwarding the few remaining mail-era stragglers.
//
// Loopback + the app's own PORT — a self request, cheap over 127.0.0.1, and the
// same cost profile as the relay HTTP calls these replaced.
export function journalRelayBase(): string {
    return `http://127.0.0.1:${process.env.PORT ?? '5173'}/relay`
}
