const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Detecta qual API usar baseado nas variáveis de ambiente
function getAPIConfig() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
    })
  });
  const status = response.status;
  if (!response.ok) {
    const err = await response.text();
    return { status, error: err };
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { status: 200, content: [{ type: 'text', text }] };
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const status = response.status;
  if (!response.ok) {
    const err = await response.text();
    return { status, error: err };
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { status: 200, content: [{ type: 'text', text }] };
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const status = response.status;
  if (!response.ok) {
    const err = await response.text();
    return { status, error: err };
  }
  const data = await response.json();
  return { status: 200, ...data };
}

app.post('/api/gerar', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Prompt não informado' });

  const api = getAPIConfig();
  if (!api) return res.status(500).json({ error: 'Nenhuma chave de API configurada no servidor.' });

  console.log(`Usando API: ${api} | Prompt: ${prompt.length} chars`);

  // Retry com backoff maior (30s, 60s, 90s)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let result;
      if (api === 'gemini') result = await callGemini(prompt);
      else if (api === 'openai') result = await callOpenAI(prompt);
      else result = await callAnthropic(prompt);

      console.log(`Tentativa ${attempt} — Status: ${result.status}`);

      if (result.status === 429) {
        if (attempt >= 3) {
          return res.status(429).json({ error: 'Limite de requisições atingido. Aguarde 2 minutos e tente novamente.' });
        }
        const wait = attempt * 30000; // 30s, 60s
        console.log(`Rate limit — aguardando ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (result.error) {
        return res.status(result.status || 500).json({ error: `Erro na API: ${result.status}`, detail: result.error });
      }

      console.log('✅ Geração concluída com sucesso');
      return res.json(result);

    } catch (err) {
      console.error('Erro interno:', err.message);
      if (attempt >= 3) {
        return res.status(500).json({ error: 'Erro interno: ' + err.message });
      }
    }
  }
});

// Rota de status para verificar qual API está ativa
app.get('/api/status', (req, res) => {
  const api = getAPIConfig();
  res.json({ api: api || 'nenhuma', status: api ? 'ok' : 'sem chave configurada' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Servidor rodando na porta ${PORT} | API: ${getAPIConfig() || 'não configurada'}`));
