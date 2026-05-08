import * as cheerio from 'cheerio';

export interface ResearchResult {
  productName: string;
  competitors: { name: string; description: string }[];
  communities: { name: string; url: string; relevance: string }[];
  trends: string[];
  potentialAngles: string[];
}

const USER_AGENT = 'Mozilla/5.0 (compatible; LaunchForge/1.0; +https://launchforge.dev)';

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractSnippets(html: string, maxResults = 5): string[] {
  const $ = cheerio.load(html);
  const results: string[] = [];

  $('.result, .result__body, article, li, .g, .rc').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 30 && results.length < maxResults) {
      results.push(text.slice(0, 300));
    }
  });

  if (results.length === 0) {
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20 && results.length < maxResults) {
        results.push(text);
      }
    });
  }

  return results;
}

async function searchDuckDuckGo(query: string): Promise<string[]> {
  const html = await fetchHtml(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
  if (!html) return [];
  return extractSnippets(html);
}

async function searchGitHub(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=5`,
      {
        headers: { 'User-Agent': 'LaunchForge', Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.items || []).slice(0, 5).map((repo: any) =>
      `${repo.full_name} — ${repo.description || 'No description'} (${repo.stargazers_count} stars)`
    );
  } catch {
    return [];
  }
}

async function searchWikipedia(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as { query?: { search?: { title: string }[] } };
    return (data.query?.search || []).map((s) => s.title);
  } catch {
    return [];
  }
}

function extractCompetitors(snippets: string[], productName: string): { name: string; description: string }[] {
  const known = new Set<string>();
  const competitors: { name: string; description: string }[] = [];

  const patterns = [
    /([A-Z][a-zA-Z0-9]+)\s*(?:is|—|-|–)\s*(?:a|an|the)?\s*([^.]{10,100})/g,
    /(?:alternative|competitor|similar)\s+(?:to|of|for)\s+([A-Z][a-zA-Z0-9]+)/gi,
    /([A-Z][a-zA-Z0-9]+)\s*(?:vs|versus|alternative)\s/gi,
  ];

  for (const snippet of snippets) {
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(snippet)) !== null) {
        const name = match[1].trim();
        if (name.toLowerCase() !== productName.toLowerCase() && name.length > 1 && !known.has(name.toLowerCase())) {
          known.add(name.toLowerCase());
          competitors.push({ name, description: match[0].slice(0, 120) });
          if (competitors.length >= 5) return competitors;
        }
      }
    }
  }

  return competitors;
}

function extractCommunities(snippets: string[]): { name: string; url: string; relevance: string }[] {
  const communities: { name: string; url: string; relevance: string }[] = [];
  const patterns = [
    { name: 'Reddit', url: 'reddit.com/r/', keyword: 'reddit' },
    { name: 'Hacker News', url: 'news.ycombinator.com', keyword: 'hacker news' },
    { name: 'Indie Hackers', url: 'indiehackers.com', keyword: 'indie hacker' },
    { name: 'Product Hunt', url: 'producthunt.com', keyword: 'product hunt' },
    { name: 'Dev.to', url: 'dev.to', keyword: 'dev.to' },
    { name: 'Stack Overflow', url: 'stackoverflow.com', keyword: 'stackoverflow' },
    { name: 'Medium', url: 'medium.com', keyword: 'medium' },
    { name: 'Discord', url: 'discord.gg', keyword: 'discord' },
    { name: 'Slack', url: 'slack.com', keyword: 'slack community' },
    { name: 'Twitter/X', url: 'twitter.com', keyword: 'twitter' },
    { name: 'LinkedIn', url: 'linkedin.com', keyword: 'linkedin' },
  ];

  const found = new Set<string>();
  for (const snippet of snippets) {
    for (const p of patterns) {
      if (snippet.toLowerCase().includes(p.keyword) && !found.has(p.name)) {
        found.add(p.name);
        communities.push({ name: p.name, url: p.url, relevance: 'Mentioned in search results' });
        if (communities.length >= 6) return communities;
      }
    }
  }

  return communities;
}

function extractTrends(snippets: string[]): string[] {
  const trends: string[] = [];
  const trendKeywords = ['trend', 'growth', 'market', 'rising', 'popular', 'new', '2024', '2025', '2026'];

  for (const snippet of snippets) {
    for (const kw of trendKeywords) {
      if (snippet.toLowerCase().includes(kw)) {
        trends.push(snippet.slice(0, 200));
        if (trends.length >= 5) return trends;
        break;
      }
    }
  }

  return trends;
}

function extractAngles(snippets: string[], productName: string): string[] {
  const angles: string[] = [];

  for (const snippet of snippets) {
    if (snippet.includes('?')) {
      const qMatch = snippet.match(/[^.]*\?[^.]*\./);
      if (qMatch) angles.push(qMatch[0].trim());
    }
    if (snippet.toLowerCase().includes('how to')) {
      const htMatch = snippet.match(/[^.]*how to[^.]*\./i);
      if (htMatch) angles.push(htMatch[0].trim());
    }
    if (angles.length >= 4) break;
  }

  if (angles.length === 0) {
    angles.push(
      `Why ${productName} is the solution your audience has been waiting for`,
      `The hidden costs of not using a tool like ${productName}`,
      `What nobody tells you about building in the ${productName} space`,
      `${productName} vs traditional approaches — a frank comparison`
    );
  }

  return angles;
}

export async function researchProduct(productName: string, description: string, niche: string): Promise<ResearchResult> {
  const queries = [
    `${productName} ${niche} alternative`,
    `${niche} software tools 2026`,
    `${niche} best tools comparison`,
    `${productName} ${niche} review`,
  ];

  const allSnippets: string[] = [];

  const ddgResults = await Promise.all(
    queries.map((q) => searchDuckDuckGo(q))
  );
  ddgResults.forEach((s) => allSnippets.push(...s));

  const ghQuery = `${productName} ${niche}`;
  const ghResults = await searchGitHub(ghQuery);
  allSnippets.push(...ghResults);

  const wikiResults = await searchWikipedia(`${niche} software`);
  allSnippets.push(...wikiResults);

  return {
    productName,
    competitors: extractCompetitors(allSnippets, productName),
    communities: extractCommunities(allSnippets),
    trends: extractTrends(allSnippets),
    potentialAngles: extractAngles(allSnippets, productName),
  };
}
