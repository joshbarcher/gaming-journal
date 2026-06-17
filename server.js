import { createServer } from 'node:http';
import { handler }      from './build/handler.js';

const server = createServer(handler);

// Node.js defaults keepAliveTimeout to 5s. When the browser reuses a
// connection the server has silently closed, it gets ECONNRESET and spends
// ~2s detecting it before retrying. Setting a long timeout keeps connections
// alive across normal reading/browsing pauses.
server.keepAliveTimeout = 10 * 60 * 1_000; // 10 minutes
server.headersTimeout   = 10 * 60 * 1_000 + 1_000;

server.listen(process.env.PORT, () => {
    console.log(`gaming-journal listening on port ${process.env.PORT}`);
});
