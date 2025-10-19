// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req,res)=>{
  try {
    let filePath = '.' + req.url;
    if(filePath === './') filePath = './index.html';
    
    // Security: prevent directory traversal
    if(filePath.includes('..') || filePath.includes('~')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    if(extname==='.js') contentType='application/javascript';
    if(extname==='.css') contentType='text/css';
    if(extname==='.json') contentType='application/json';

    // Cross‑Origin Isolation headers (required for SharedArrayBuffer)
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    
    // Additional security headers
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');

    fs.readFile(filePath, (err,data)=>{
      if(err){
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.setHeader('Content-Type',contentType);
      res.end(data);
    });
  } catch(error) {
    console.error('Server error:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}).listen(8080,()=>console.log('Server listening on http://localhost:8080'));
