const http = require('http');
const BUG = process.env.BUG === '1';
http.createServer((req, res) => {
  if (req.url === '/api/pay' && req.method === 'POST') {
    res.statusCode = BUG ? 405 : 200;
    return res.end(BUG ? 'Method Not Allowed' : 'ok');
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<h1>Checkout</h1>
  <form onsubmit="event.preventDefault();fetch('/api/pay',{method:'POST'}).then(r=>document.getElementById('msg').textContent=r.ok?'Paid':'Payment failed')">
    <label>Name <input name="name"></label>
    <label>Password <input type="password" name="pw"></label>
    <button type="submit">Pay now</button>
  </form><p id="msg"></p>`);
}).listen(3000, () => console.log('demo on http://localhost:3000, bug=' + BUG));