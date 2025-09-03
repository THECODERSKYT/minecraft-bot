const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve a simple webpage
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>ChatGPT Minecraft Bot</title>
        <style>
          body {
            background: #111;
            color: #0f0;
            font-family: monospace;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          h1 { font-size: 3em; }
          p { font-size: 1.2em; }
        </style>
      </head>
      <body>
        <h1>ChatGPT Minecraft Bot</h1>
        <p>Bot is running smoothly. Check your console for logs.</p>
      </body>
    </html>
  `);
});

// Keep bot running alongside web server
require('./index.js');

app.listen(PORT, () => {
  console.log(`Web page running on port ${PORT}`);
});
