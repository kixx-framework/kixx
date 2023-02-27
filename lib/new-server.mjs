import http from 'node:http';

const server = http.createServer((req, res) => {
    const request = new Request('http://localhost:8080', req);
    const response = new Response(res);

    console.log('Request:');
    console.log(request.method);
    console.log(request.headers);
    console.log(request.url);
    console.log('Response:');
    console.log(response);

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('pong');
    res.end();
});

server.on('listening', () => {
    console.log('server listening');
});

server.listen(8080);
