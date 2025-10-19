// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req,res)=>{
  let filePath = '.' + req.url;
  if(filePath === './') filePath = './index.html';
  const extname = path.extname(filePath);
  let contentType = 'text/html';
  if(extname==='.js') contentType='application/javascript';

  // Cross‑Origin Isolation headers
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');

  fs.readFile(filePath, (err,data)=>{
    if(err){
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type',contentType);
    res.end(data);
  });
}).listen(8080,()=>console.log('Server listening on http://localhost:8080'));
