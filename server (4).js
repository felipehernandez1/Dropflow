const express = require('express');
const path = require('path');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '2mb' }));

app.post('/api/ia', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  console.log('=== /api/ia llamado ===');
  console.log('API Key presente:', !!apiKey);
  console.log('API Key primeros 10 chars:', apiKey ? apiKey.substring(0, 10) : 'NINGUNA');

  if (!apiKey) {
    return res.status(500).json({ error: { message: 'API key no configurada en Render' } });
  }

  const body = JSON.stringify(req.body);

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    console.log('Respuesta Anthropic status:', apiRes.statusCode);
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log('Respuesta Anthropic body:', data.substring(0, 200));
      try {
        res.status(apiRes.statusCode).json(JSON.parse(data));
      } catch (e) {
        res.status(500).json({ error: { message: 'Error parseando respuesta: ' + data.substring(0, 100) } });
      }
    });
  });

  apiReq.on('error', (err) => {
    console.log('Error request:', err.message);
    res.status(500).json({ error: { message: 'Error de conexion: ' + err.message } });
  });

  apiReq.write(body);
  apiReq.end();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dropflow.html'));
});

app.listen(PORT, () => {
  console.log('Dropflow corriendo en puerto ' + PORT);
  console.log('ANTHROPIC_API_KEY configurada:', !!process.env.ANTHROPIC_API_KEY);
});
