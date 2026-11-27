import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { checkedPreviewOrigin } from './https-preview-contract.mjs';

// Loopback-only CONNECT relay. TLS stays end-to-end; no local CA, plaintext
// interception, system proxy changes or access to other origins.
export async function startPreviewNetworkGate(origin, { connect = net.connect } = {}) {
    const hostname = new URL(checkedPreviewOrigin(origin)).hostname;
    let offline = false, stopped = false, opened = 0, refused = 0, rejected = 0;
    const sockets = new Set();
    const track = socket => {
        sockets.add(socket); socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy()); socket.setTimeout(15000, () => socket.destroy());
        return socket;
    };
    const server = http.createServer((_request, response) => { rejected++; response.writeHead(403); response.end(); });
    server.on('connection', socket => {
        if (sockets.size >= 64) { socket.destroy(); return; }
        track(socket);
    });
    server.on('connect', (request, client, head) => {
        if (request.url !== `${hostname}:443`) { rejected++; client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
        if (offline || stopped || sockets.size >= 64) { refused++; client.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\n\r\n'); return; }
        const upstream = track(connect({ host: hostname, port: 443 }));
        client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
        upstream.once('connect', () => {
            if (offline || stopped || client.destroyed) { upstream.destroy(); return; }
            opened++;
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            client.pipe(upstream); upstream.pipe(client);
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        snapshot: () => ({ offline, opened, refused, rejected, liveSockets: sockets.size }),
        setOffline(value) {
            assert.equal(typeof value, 'boolean'); offline = value;
            if (offline) for (const socket of sockets) socket.destroy();
        },
        async close() {
            if (stopped) return;
            stopped = true; for (const socket of sockets) socket.destroy();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
    };
}
