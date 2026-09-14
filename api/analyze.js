// /api/analyze.js
// Recebe a lista de times do PES, busca cada um no Transfermarkt em paralelo,
// e retorna a análise completa: quem entrou, quem saiu, o que corrigir

const TM_BASE = 'https://transfermarkt-api.fly.dev';

// Mapas de posição TM → PES
const POS_MAP = {
  'Goalkeeper': 'GOL', 'Centre-Back': 'ZAG', 'Left-Back': 'LE', 'Right-Back': 'LD',
  'Defensive Midfield': 'VOL', 'Central Midfield': 'MC', 'Attacking Midfield': 'MEI',
  'Left Winger': 'EE', 'Right Winger': 'ED', 'Centre-Forward': 'CA', 'Second Striker': 'SS',
  'Left Midfield': 'MEI', 'Right Midfield': 'MEI', 'Striker': 'CA'
};

function mapPos(p) { return POS_MAP[p] || 'MC'; }

function parseVal(v) {
  if (!v) return 0;
  const s = String(v).replace(/[€\s]/g, '').toUpperCase();
  if (s.includes('M')) return parseFloat(s) * 1e6;
  if (s.includes('K')) return parseFloat(s) * 1e3;
  return parseInt(s.replace(/\D/g, '')) || 0;
}

// Converte valor de mercado do TM em OVR aproximado (escala 1-99)
function valueToOvr(value, age) {
  const v = parseVal(value);
  let base = 60;
  if (v >= 100e6) base = 90;
  else if (v >= 60e6) base = 87;
  else if (v >= 30e6) base = 84;
  else if (v >= 15e6) base = 81;
  else if (v >= 5e6)  base = 77;
  else if (v >= 1e6)  base = 72;
  else if (v > 0)     base = 65;

  // Ajuste de idade: pico entre 24-29
  const a = parseInt(age) || 25;
  if (a < 20) base -= 4;
  else if (a > 32) base -= 3;
  else if (a > 30) base -= 1;

  return Math.min(99, Math.max(55, base));
}

// Gera stats aproximados baseados em OVR e posição
function ovrToStats(ovr, pos) {
  const base = ovr;
  const isGK  = pos === 'GOL';
  const isDef = ['ZAG','LD','LE'].includes(pos);
  const isMid = ['VOL','MC','MEI','EE','ED'].includes(pos);
  const isFwd = ['CA','SS','PE'].includes(pos);

  const r = (b, spread = 8) => Math.min(99, Math.max(40, Math.round(b + (Math.random() * spread - spread / 2))));
  return {
    vel: r(isDef ? base - 8 : isFwd ? base - 2 : base - 5),
    ace: r(isDef ? base - 6 : isFwd ? base - 2 : base - 4),
    res: r(base - 5),
    alt: r(isDef ? base - 1 : isFwd ? base - 6 : base - 8, 12),
    equ: r(isFwd ? base - 1 : base - 8),
    sal: r(isDef ? base - 2 : base - 8),
    p_c: r(isMid ? base - 1 : base - 7),
    p_l: r(isMid ? base - 3 : base - 9),
    dri: r(isFwd ? base - 1 : base - 9),
    chu: r(isFwd ? base - 1 : base - 10),
    c_l: r(isFwd ? base - 4 : base - 12),
    cab: r(isDef ? base - 2 : base - 9),
    pre: r(isDef ? base - 2 : base - 6),
    des: r(isDef ? base - 1 : base - 11),
    agr: r(base - 10, 14),
    ref: r(isGK ? base - 1 : 42, isGK ? 5 : 8),
  };
}

async function fetchClub(teamName) {
  try {
    const searchRes = await fetch(`${TM_BASE}/clubs/search/${encodeURIComponent(teamName)}`, {
      headers: { accept: 'application/json' }
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const clubs = searchData.results || searchData.clubs || searchData || [];
    if (!clubs.length) return null;

    const nameLower = teamName.toLowerCase().trim();
    const best =
      clubs.find(c => (c.name || '').toLowerCase().trim() === nameLower) ||
      clubs.find(c => (c.name || '').toLowerCase().startsWith(nameLower)) ||
      clubs[0];

    const squadRes = await fetch(`${TM_BASE}/clubs/${best.id}/players`, {
      headers: { accept: 'application/json' }
    });
    if (!squadRes.ok) return null;
    const squadData = await squadRes.json();
    return {
      clubId: best.id,
      clubName: best.name || teamName,
      players: squadData.players || squadData.results || []
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { teams } = req.body;
  if (!teams || !Array.isArray(teams)) return res.status(400).json({ error: 'Body deve ter "teams": []' });

  // Excluir times não pesquisáveis (genéricos)
  const searchable = teams.filter(t => t !== 'Outros' && t.length > 2);

  // Buscar todos em paralelo (com limite de 8 simultâneos para não sobrecarregar)
  const results = {};
  const CHUNK = 8;
  for (let i = 0; i < searchable.length; i += CHUNK) {
    const chunk = searchable.slice(i, i + CHUNK);
    const fetched = await Promise.all(chunk.map(name => fetchClub(name).then(r => ({ name, r }))));
    fetched.forEach(({ name, r }) => { results[name] = r; });
  }

  // Montar análise por time
  const analysis = {};
  for (const [teamName, tmData] of Object.entries(results)) {
    if (!tmData) {
      analysis[teamName] = { found: false };
      continue;
    }

    const tmPlayers = tmData.players.map(p => {
      let nat = p.nationality;
      if (Array.isArray(nat)) nat = nat.join(', ');
      const age = p.age !== undefined ? p.age : null;
      const valueRaw = parseVal(p.marketValue || p.market_value_in_eur);
      const ovr = valueToOvr(p.marketValue || p.market_value_in_eur, age);
      const pos = mapPos(p.position || p.mainPosition || '');
      return {
        name: (p.name || p.playerName || '').toUpperCase(),
        fullName: p.name || '',
        position: pos,
        nationality: nat || '',
        age: age,
        marketValue: p.marketValue || '',
        valueRaw,
        ovr,
        stats: ovrToStats(ovr, pos),
      };
    });

    analysis[teamName] = {
      found: true,
      clubId: tmData.clubId,
      clubName: tmData.clubName,
      tmPlayers,
    };
  }

  return res.status(200).json({ analysis });
                                  }
