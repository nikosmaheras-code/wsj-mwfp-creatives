// Serverless proxy for Polymarket finance/privates events.
// Returns one card object per company, each with up to 2 outcome rows.
// Vercel caches at the CDN edge for 1 hour; Polymarket is hit at most once/hour per region.

const POLYMARKET_URL =
  'https://gamma-api.polymarket.com/events?active=true&limit=30&tag_slug=privates&order=volume&ascending=false';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');

  try {
    const upstream = await fetch(POLYMARKET_URL);
    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream error', status: upstream.status });
      return;
    }

    const events = await upstream.json();
    const cards = parseEvents(events);
    res.status(200).json(cards);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// Matches individual company valuation events: "Will Anthropic's valuation hit __ by …"
// The API uses Unicode curly apostrophe (U+2019) so we match both that and ASCII '.
const VALUATION_RE = /will (.+?)[’']s?\s+valuation hit/i;

function parseEvents(events) {
  // De-duplicate by company: keep the event (June vs Dec) with highest total volume.
  const byCompany = new Map();

  for (const evt of events) {
    const m = VALUATION_RE.exec(evt.title || '');
    if (!m) continue; // skip comparison / multi-company events

    const company = m[1].trim();
    const vol = parseFloat(evt.volume || 0);
    const existing = byCompany.get(company);

    if (!existing || vol > parseFloat(existing.volume || 0)) {
      byCompany.set(company, evt);
    }
  }

  const cards = [];
  for (const [company, evt] of byCompany) {
    const card = eventToCard(company, evt);
    if (card) cards.push(card);
  }

  // Sort by event volume descending so the most-traded companies appear first.
  cards.sort((a, b) => b.volume - a.volume);
  return cards.slice(0, 8);
}

function eventToCard(company, evt) {
  // Keep only binary yes/no markets.
  const markets = (evt.markets || []).filter(m => {
    let outcomes = [];
    try { outcomes = JSON.parse(m.outcomes || '[]'); } catch (_) {}
    return (
      outcomes.length === 2 &&
      outcomes[0].toLowerCase() === 'yes' &&
      outcomes[1].toLowerCase() === 'no'
    );
  });

  if (!markets.length) return null;

  // Pick the 2 markets with highest volume — these are the most tradeable / interesting.
  markets.sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0));
  const top2 = markets.slice(0, 2);

  // Sort the pair so the higher valuation always appears first (ascending valuation label).
  // We do a simple numeric sort on the dollar amount embedded in groupItemTitle.
  top2.sort((a, b) => extractDollarAmount(b.groupItemTitle) - extractDollarAmount(a.groupItemTitle));

  const outcomes = top2.map(m => {
    let yesPct = 50;
    try {
      const prices = JSON.parse(m.outcomePrices || '[]');
      if (prices.length >= 1) yesPct = Math.round(parseFloat(prices[0]) * 100);
    } catch (_) {}

    return {
      valuation: (m.groupItemTitle || '').trim(),
      yesPct,
      noPct: 100 - yesPct,
      slug: m.slug || '',
    };
  });

  return {
    company,
    question: evt.title || '',
    icon: evt.icon || '',
    slug: evt.slug || '',
    volume: parseFloat(evt.volume || 0),
    outcomes,
  };
}

// Extract the numeric dollar value from labels like "↑$1.75T", "↓$800B", "↑ $950B"
function extractDollarAmount(label) {
  if (!label) return 0;
  const m = label.match(/\$([\d.]+)\s*([BT])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  return unit === 'T' ? n * 1000 : n; // normalise to billions
}
