// /api/club.js
// Proxy para a API do Transfermarkt — busca elenco de um clube pelo nome
// Evita CORS: o browser chama /api/club e este servidor faz a requisição real

const TM_BASE = 'https://transfermarkt-api.fly.dev';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, id } = req.query;
  if (!name && !id) return res.status(400).json({ error: 'Parâmetro "name" ou "id" obrigatório' });

  try {
    let clubId = id;
    let clubName = name || `Clube #${id}`;

    // Se não temos o ID, buscamos pelo nome
    if (!clubId) {
      const searchRes = await fetch(`${TM_BASE}/clubs/search/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' }
      });
      if (!searchRes.ok) throw new Error(`Busca falhou: ${searchRes.status}`);
      const searchData = await searchRes.json();
      const clubs = searchData.results || searchData.clubs || searchData || [];
      if (!clubs.length) throw new Error(`Nenhum clube encontrado para "${name}"`);

      // Preferir correspondência exata
      const nameLower = name.toLowerCase().trim();
      const best =
        clubs.find(c => (c.name || '').toLowerCase().trim() === nameLower) ||
        clubs.find(c => (c.name || '').toLowerCase().startsWith(nameLower)) ||
        clubs[0];

      clubId = best.id;
      clubName = best.name || name;
    }

    // Buscar elenco completo
    const squadRes = await fetch(`${TM_BASE}/clubs/${clubId}/players`, {
      headers: { accept: 'application/json' }
    });
    if (!squadRes.ok) throw new Error(`Elenco falhou: ${squadRes.status}`);
    const squadData = await squadRes.json();
    const players = squadData.players || squadData.results || [];

    return res.status(200).json({ clubId, clubName, players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
        }

