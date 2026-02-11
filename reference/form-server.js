import { createServer } from 'node:http';

/* eslint-disable no-console */

const PORT = 3100;

const HOME_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Form Server</title>
    <style>
        body {
            background-color: #000;
            color: #fff;
            font-family: sans-serif;
            display: flex;
            justify-content: center;
            padding-top: 100px;
        }
        form {
            display: flex;
            flex-direction: column;
            gap: 16px;
            width: 400px;
        }
        label {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 14px;
        }
        input[type="text"],
        input[type="datetime-local"],
        input[type="number"],
        textarea,
        select {
            padding: 8px;
            font-size: 16px;
            border: 1px solid #555;
            background-color: #222;
            color: #fff;
            border-radius: 4px;
        }
        textarea {
            resize: vertical;
            min-height: 80px;
        }
        fieldset {
            border: 1px solid #555;
            border-radius: 4px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        legend {
            font-size: 14px;
            padding: 0 4px;
        }
        .checkbox-item,
        .radio-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        button {
            padding: 8px 16px;
            font-size: 16px;
            cursor: pointer;
            border: 1px solid #555;
            background-color: #333;
            color: #fff;
            border-radius: 4px;
            align-self: flex-start;
        }
    </style>
</head>
<body>
    <form method="POST" action="/">
        <label>
            Text
            <input type="text" name="text" placeholder="Type something..." />
        </label>
        <label>
            Text Area
            <textarea name="textarea" placeholder="Type something..."></textarea>
        </label>
        <label>
            Single Select
            <select name="singleSelect">
                <option value="">-- Choose --</option>
                <option value="alpha">Alpha</option>
                <option value="bravo">Bravo</option>
                <option value="charlie">Charlie</option>
            </select>
        </label>
        <label>
            Multi Select
            <select name="multiSelect" multiple>
                <option value="alpha">Alpha</option>
                <option value="bravo">Bravo</option>
                <option value="charlie">Charlie</option>
            </select>
        </label>
        <fieldset>
            <legend>Checkbox List</legend>
            <div class="checkbox-item">
                <input type="checkbox" id="cb-alpha" name="checkboxList" value="alpha" />
                <label for="cb-alpha">Alpha</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" id="cb-bravo" name="checkboxList" value="bravo" />
                <label for="cb-bravo">Bravo</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" id="cb-charlie" name="checkboxList" value="charlie" />
                <label for="cb-charlie">Charlie</label>
            </div>
        </fieldset>
        <fieldset>
            <legend>Radio List</legend>
            <div class="radio-item">
                <input type="radio" id="rb-alpha" name="radioList" value="alpha" />
                <label for="rb-alpha">Alpha</label>
            </div>
            <div class="radio-item">
                <input type="radio" id="rb-bravo" name="radioList" value="bravo" />
                <label for="rb-bravo">Bravo</label>
            </div>
            <div class="radio-item">
                <input type="radio" id="rb-charlie" name="radioList" value="charlie" />
                <label for="rb-charlie">Charlie</label>
            </div>
        </fieldset>
        <label>
            Color
            <input type="color" name="color" />
        </label>
        <label>
            Datetime
            <input type="datetime-local" name="datetime" />
        </label>
        <label>
            Number
            <input type="number" name="number" />
        </label>
        <label>
            Range
            <input type="range" name="range" min="0" max="100" />
        </label>
        <button type="submit">Submit</button>
    </form>
</body>
</html>`;

function sendHomePage(res) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HOME_PAGE_HTML);
}

const server = createServer((req, res) => {
    const { method, url } = req;

    if (url !== '/') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    if (method === 'GET') {
        sendHomePage(res);
        return;
    }

    if (method === 'POST') {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            // URLSearchParams handles URL decoding automatically
            const params = new URLSearchParams(body);
            console.log('--- Form POST Data ---');
            for (const [ key, value ] of params) {
                console.log(key, '=>', typeof value, value);
            }
            console.log('----------------------');
            sendHomePage(res);
        });

        return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
});

server.listen(PORT, () => {
    console.log(`Form server listening on http://localhost:${ PORT }/`);
});
