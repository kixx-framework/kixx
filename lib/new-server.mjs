import http from 'node:http';

const handleRequest = async (req, res) => {
    const request = new Request('http://localhost:8080', {
        method: req.method,
        headers: new Headers(req.headers),
        body: res,
    });

    console.log('Request:');
    console.log(request.method);
    console.log(Object.fromEntries(request.headers.entries()));
    console.log(request.url);

    const body = await request.json();

    console.log('body =>', body);

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('pong\n');
    res.end();
};

const server = http.createServer(handleRequest);

server.on('listening', () => {
    console.log('server listening');
});

server.listen(8080);
