// Notion → Blog sync script
// Fetches ✅ Published posts from Notion and generates styled HTML pages

const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = '0a2d2ccf3c294d60a31a51d7dce0ba1c';
const SITE_DOMAIN = 'https://newsletterengine.io';
const NOTION_VERSION = '2022-06-28';

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN environment variable is required');
  process.exit(1);
}

// ─── Notion API ──────────────────────────────────────────────────────────────

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API ${res.status}: ${err}`);
  }
  return res.json();
}

async function getPublishedPosts() {
  const data = await notionFetch(`/databases/${DATABASE_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { property: 'Status', select: { equals: '✅ Published' } },
      sorts: [{ property: 'Publish Date', direction: 'descending' }],
    }),
  });
  return data.results || [];
}

async function getPageBlocks(pageId) {
  const data = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
  return data.results || [];
}

async function updateLiveUrl(pageId, url) {
  await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { 'Live URL': { url } } }),
  });
}

// ─── Block → HTML ────────────────────────────────────────────────────────────

function rt(richTexts) {
  if (!richTexts?.length) return '';
  return richTexts.map(t => {
    let s = (t.plain_text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    if (!s) return '';
    if (t.annotations?.bold)          s = `<strong>${s}</strong>`;
    if (t.annotations?.italic)        s = `<em>${s}</em>`;
    if (t.annotations?.strikethrough) s = `<s>${s}</s>`;
    if (t.annotations?.code)          s = `<code>${s}</code>`;
    if (t.href)                        s = `<a href="${t.href}">${s}</a>`;
    return s;
  }).join('');
}

function blockHtml(b) {
  switch (b.type) {
    case 'heading_1':         return `<h2>${rt(b.heading_1.rich_text)}</h2>`;
    case 'heading_2':         return `<h3>${rt(b.heading_2.rich_text)}</h3>`;
    case 'heading_3':         return `<h4>${rt(b.heading_3.rich_text)}</h4>`;
    case 'paragraph':         return rt(b.paragraph.rich_text) ? `<p>${rt(b.paragraph.rich_text)}</p>` : '';
    case 'bulleted_list_item':return `<li>${rt(b.bulleted_list_item.rich_text)}</li>`;
    case 'numbered_list_item':return `<li>${rt(b.numbered_list_item.rich_text)}</li>`;
    case 'quote':             return `<blockquote>${rt(b.quote.rich_text)}</blockquote>`;
    case 'code':              return `<pre><code>${rt(b.code.rich_text)}</code></pre>`;
    case 'divider':           return `<hr>`;
    case 'callout': {
      const icon = b.callout.icon?.emoji ? `${b.callout.icon.emoji} ` : '';
      return `<div class="callout">${icon}${rt(b.callout.rich_text)}</div>`;
    }
    case 'image': {
      const url = b.image?.file?.url || b.image?.external?.url || '';
      const cap = rt(b.image?.caption || []);
      return url ? `<figure><img src="${url}" alt="${cap}" loading="lazy">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>` : '';
    }
    default: return '';
  }
}

function blocksToHtml(blocks) {
  let html = '';
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'bulleted_list_item') {
      html += '<ul>';
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') html += blockHtml(blocks[i++]);
      html += '</ul>';
    } else if (b.type === 'numbered_list_item') {
      html += '<ol>';
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') html += blockHtml(blocks[i++]);
      html += '</ol>';
    } else {
      html += blockHtml(b);
      i++;
    }
  }
  return html;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

// ─── Page templates ───────────────────────────────────────────────────────────

const NAV = `
<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="wordmark">Newsletter Engine<span class="dot"></span></a>
    <a href="https://form.typeform.com/to/S6w11Pw6" target="_blank" rel="noopener" class="btn btn-primary">Book a free strategy session</a>
  </div>
</nav>`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

const BASE_CSS = `
  :root{--bg:#faf7f1;--bg-warm:#f4efe6;--ink:#14110d;--ink-soft:#2a2620;--muted:#6e6860;--muted-soft:#948e85;--rule:#e6e0d3;--dark:#0e0c0a;--accent:#2f7d51;--accent-soft:#d8e9df;--gold:#c8a64b;--serif:'Fraunces',serif;--sans:'Inter',sans-serif;}
  *,*::before,*::after{box-sizing:border-box;}
  html{scroll-behavior:smooth;-webkit-text-size-adjust:100%;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.8;-webkit-font-smoothing:antialiased;}
  a{color:inherit;text-decoration:none;}
  img{max-width:100%;display:block;}
  ::selection{background:var(--ink);color:var(--bg);}
  .nav{position:sticky;top:0;z-index:100;background:rgba(250,247,241,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--rule);}
  .nav-inner{max-width:1100px;margin:0 auto;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;}
  .wordmark{font-family:var(--serif);font-weight:600;font-size:20px;letter-spacing:-0.02em;font-variation-settings:"opsz" 144;}
  .wordmark .dot{width:6px;height:6px;border-radius:50%;background:var(--ink);display:inline-block;transform:translateY(-3px);}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:8px;font-family:var(--sans);font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;border:none;}
  .btn-primary{background:var(--ink);color:var(--bg);}
  .btn-primary:hover{background:#2a2620;}
  .footer{border-top:1px solid var(--rule);padding:36px 32px;text-align:center;font-size:13px;color:var(--muted);}
  @media(max-width:720px){.nav-inner{padding:14px 22px;}.nav .btn{display:none;}}`;

function postPage({ title, keyword, publishDate, funnelStage, content }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title.replace(/"/g,'&quot;')} | Newsletter Engine</title>
<meta name="description" content="${keyword ? `Everything you need to know about ${keyword}.` : title}"/>
<link rel="icon" href="/favicon.ico" sizes="any">
${FONTS}
<style>
  ${BASE_CSS}
  .wrap{max-width:740px;margin:0 auto;padding:0 32px;}
  .post-hero{padding:72px 0 52px;border-bottom:1px solid var(--rule);}
  .back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);margin-bottom:28px;transition:color .15s;}
  .back:hover{color:var(--ink);}
  .kw-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);padding:4px 10px;border-radius:4px;margin-bottom:16px;}
  .post-hero h1{font-family:var(--serif);font-size:clamp(30px,5vw,52px);font-weight:700;line-height:1.1;letter-spacing:-0.025em;margin:0 0 20px;font-variation-settings:"opsz" 144;}
  .post-meta{font-size:13px;color:var(--muted);}
  .post-body{padding:56px 0 80px;}
  .post-body p{margin:0 0 24px;color:var(--ink-soft);}
  .post-body h2{font-family:var(--serif);font-size:clamp(22px,3.5vw,32px);font-weight:700;margin:52px 0 16px;letter-spacing:-0.02em;line-height:1.15;color:var(--ink);font-variation-settings:"opsz" 144;}
  .post-body h3{font-family:var(--serif);font-size:clamp(19px,2.5vw,24px);font-weight:600;margin:40px 0 12px;letter-spacing:-0.015em;color:var(--ink);}
  .post-body h4{font-family:var(--sans);font-size:16px;font-weight:700;margin:32px 0 8px;color:var(--ink);}
  .post-body ul,.post-body ol{margin:0 0 24px;padding-left:26px;color:var(--ink-soft);}
  .post-body li{margin-bottom:10px;}
  .post-body blockquote{border-left:3px solid var(--accent);margin:36px 0;padding:16px 24px;background:#f4efe6;border-radius:0 10px 10px 0;font-style:italic;color:var(--ink);}
  .post-body code{font-family:ui-monospace,monospace;background:#f0ece4;padding:2px 6px;border-radius:4px;font-size:14px;}
  .post-body pre{background:#1e1c18;color:#f3efe6;padding:24px;border-radius:12px;overflow-x:auto;margin:0 0 24px;}
  .post-body pre code{background:none;padding:0;font-size:14px;}
  .post-body hr{border:none;border-top:1px solid var(--rule);margin:44px 0;}
  .post-body a{color:var(--accent);text-decoration:underline;text-underline-offset:3px;}
  .post-body figure{margin:0 0 32px;}
  .post-body figure img{border-radius:10px;width:100%;}
  .post-body figcaption{font-size:13px;color:var(--muted);margin-top:8px;text-align:center;}
  .callout{background:#f4efe6;border:1px solid var(--rule);border-radius:10px;padding:18px 22px;margin:0 0 24px;font-size:15px;}
  .post-cta{background:var(--ink);color:#f3efe6;border-radius:16px;padding:48px 40px;text-align:center;margin:56px 0 0;}
  .post-cta h3{font-family:var(--serif);font-size:28px;font-weight:700;color:#f6f1e6;margin:0 0 10px;font-variation-settings:"opsz" 144;}
  .post-cta p{color:#b8b0a2;margin:0 0 24px;font-size:15px;}
  .post-cta .btn{display:inline-flex;margin:0 auto;}
  @media(max-width:720px){.wrap{padding:0 22px;}.post-hero{padding:48px 0 36px;}.post-body{padding:36px 0 56px;}.post-cta{padding:32px 22px;}}
</style>
</head>
<body>
${NAV}
<article>
  <div class="post-hero">
    <div class="wrap">
      <a href="/blog/" class="back">← All posts</a>
      ${keyword ? `<div class="kw-tag">${keyword.replace(/</g,'&lt;')}</div>` : ''}
      <h1>${title}</h1>
      ${publishDate ? `<div class="post-meta">${formatDate(publishDate)}${funnelStage ? ` · ${funnelStage}` : ''}</div>` : ''}
    </div>
  </div>
  <div class="post-body">
    <div class="wrap">
      ${content}
      <div class="post-cta">
        <h3>Want a newsletter that actually converts?</h3>
        <p>We write, design, and send it every week — in your voice, under your name.</p>
        <a href="https://form.typeform.com/to/S6w11Pw6" target="_blank" rel="noopener" class="btn btn-primary">Book a free strategy session →</a>
      </div>
    </div>
  </div>
</article>
<footer class="footer">
  <a href="/" style="color:inherit">Newsletter Engine</a> · © ${year} All rights reserved · <a href="/blog/" style="color:inherit">Blog</a>
</footer>
</body>
</html>`;
}

function blogIndexPage(posts) {
  const year = new Date().getFullYear();

  const featured = posts[0] || null;
  const rest = posts.slice(1);

  const featuredHtml = featured ? `
  <a href="/blog/${featured.slug}/" class="featured-card">
    <div class="featured-label">
      <span class="eyebrow">Featured</span>
    </div>
    <div class="featured-body">
      ${featured.funnelStage ? `<span class="tag">${featured.funnelStage}</span>` : ''}
      <h2>${featured.title}</h2>
      ${featured.keyword ? `<p class="featured-kw">On: ${featured.keyword.replace(/</g,'&lt;')}</p>` : ''}
      <span class="read-link">Read article →</span>
    </div>
  </a>` : '';

  const gridCards = rest.length ? rest.map(p => `
    <a href="/blog/${p.slug}/" class="post-card">
      <div class="post-card-inner">
        ${p.funnelStage ? `<span class="tag">${p.funnelStage}</span>` : ''}
        <h3>${p.title}</h3>
        ${p.keyword ? `<p class="post-kw">${p.keyword.replace(/</g,'&lt;')}</p>` : ''}
        <span class="read-link">Read post →</span>
      </div>
    </a>`).join('')
    : '';

  const emptyState = !posts.length
    ? '<p style="color:var(--muted);padding:80px 0;text-align:center;grid-column:1/-1;font-size:15px;">Posts coming soon.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Blog | Newsletter Engine</title>
<meta name="description" content="Insights on newsletters, content strategy, and building an audience that converts."/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="any">
${FONTS}
<style>
  ${BASE_CSS}
  .wrap{max-width:1100px;margin:0 auto;padding:0 32px;}

  /* Hero */
  .blog-hero{background:var(--dark);color:#f3efe6;padding:100px 0 80px;position:relative;overflow:hidden;}
  .blog-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 80% at 80% 50%,rgba(47,125,81,.12) 0%,transparent 70%);pointer-events:none;}
  .blog-hero .eyebrow{color:#6e6860;}
  .blog-hero h1{font-family:var(--serif);font-size:clamp(44px,6vw,80px);font-weight:700;margin:0 0 20px;letter-spacing:-0.028em;line-height:1.05;color:#f6f1e6;font-variation-settings:"opsz" 144;max-width:700px;}
  .blog-hero h1 em{font-style:italic;color:#c8a64b;}
  .blog-hero p{font-size:18px;color:#9a948a;max-width:460px;margin:0;line-height:1.65;}

  /* Featured */
  .featured-wrap{padding:64px 0 0;}
  .featured-card{display:grid;grid-template-columns:1fr 1fr;gap:0;background:#fff;border:1px solid var(--rule);border-radius:18px;overflow:hidden;transition:all .22s;text-decoration:none;color:inherit;}
  .featured-card:hover{border-color:var(--ink);box-shadow:0 12px 48px rgba(20,17,13,.1);transform:translateY(-2px);}
  .featured-label{background:var(--dark);display:flex;align-items:flex-end;padding:40px 44px;min-height:240px;position:relative;}
  .featured-label::before{content:'"';position:absolute;top:24px;left:40px;font-family:var(--serif);font-size:120px;color:rgba(255,255,255,.06);line-height:1;font-variation-settings:"opsz" 144;}
  .featured-label .eyebrow{color:#6e6860;position:relative;z-index:1;}
  .featured-body{padding:40px 44px;display:flex;flex-direction:column;gap:12px;justify-content:center;}
  .featured-body h2{font-family:var(--serif);font-size:clamp(22px,2.8vw,32px);font-weight:700;margin:0;line-height:1.2;letter-spacing:-0.02em;font-variation-settings:"opsz" 144;color:var(--ink);}
  .featured-kw{font-size:13px;color:var(--muted);margin:0;}

  /* Grid */
  .posts-section{padding:40px 0 100px;}
  .section-label{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:28px;}
  .posts-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
  .post-card{display:block;background:#fff;border:1px solid var(--rule);border-radius:14px;overflow:hidden;transition:all .2s;text-decoration:none;color:inherit;}
  .post-card:hover{border-color:var(--ink);transform:translateY(-2px);box-shadow:0 8px 32px rgba(20,17,13,.07);}
  .post-card-inner{padding:28px;display:flex;flex-direction:column;gap:10px;height:100%;}
  .post-card-inner h3{font-family:var(--serif);font-size:20px;font-weight:600;margin:0;line-height:1.3;letter-spacing:-0.015em;font-variation-settings:"opsz" 144;color:var(--ink);}
  .post-kw{font-size:13px;color:var(--muted);margin:0;}

  /* Shared */
  .tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
  .read-link{font-size:13px;font-weight:600;color:var(--accent);margin-top:auto;padding-top:4px;}

  /* Bottom CTA */
  .blog-cta{background:var(--dark);margin:0;padding:96px 0;}
  .blog-cta-inner{text-align:center;max-width:560px;margin:0 auto;}
  .blog-cta h2{font-family:var(--serif);font-size:clamp(34px,4vw,52px);font-weight:700;color:#f6f1e6;margin:0 0 16px;letter-spacing:-0.025em;line-height:1.1;font-variation-settings:"opsz" 144;}
  .blog-cta h2 em{font-style:italic;color:#c8a64b;}
  .blog-cta p{color:#9a948a;font-size:17px;margin:0 0 32px;line-height:1.65;}
  .blog-cta .btn{display:inline-flex;background:#faf7f1;color:var(--ink);}
  .blog-cta .btn:hover{background:#fff;}

  @media(max-width:900px){.posts-grid{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:720px){
    .wrap{padding:0 22px;}
    .blog-hero{padding:70px 0 56px;}
    .featured-wrap{padding:40px 0 0;}
    .featured-card{grid-template-columns:1fr;}
    .featured-label{min-height:120px;padding:28px 28px;}
    .featured-body{padding:28px 28px;}
    .posts-section{padding:32px 0 60px;}
    .posts-grid{grid-template-columns:1fr;gap:16px;}
    .blog-cta{padding:64px 0;}
  }
</style>
</head>
<body>
${NAV}

<div class="blog-hero">
  <div class="wrap">
    <span class="eyebrow">The Newsletter Engine Blog</span>
    <h1>Strategy, growth,<br>and <em>real results.</em></h1>
    <p>Practical newsletter advice from people who write, grow, and monetise them every week.</p>
  </div>
</div>

<div class="wrap">
  ${featured ? `<div class="featured-wrap">${featuredHtml}</div>` : ''}
  <div class="posts-section">
    ${rest.length ? `<p class="section-label">Recent Posts</p>` : ''}
    <div class="posts-grid">${gridCards}${emptyState}</div>
  </div>
</div>

<div class="blog-cta">
  <div class="blog-cta-inner">
    <h2>Ready to stop reading<br>and <em>start sending?</em></h2>
    <p>Book a free 20-minute call and we'll map out your newsletter strategy — whether you work with us or not.</p>
    <a href="https://form.typeform.com/to/S6w11Pw6" target="_blank" rel="noopener" class="btn btn-primary">Book your free strategy call →</a>
  </div>
</div>

<footer class="footer">
  <a href="/" style="color:inherit">Newsletter Engine</a> · © ${year} All rights reserved
</footer>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Fetching published posts from Notion...');
  const pages = await getPublishedPosts();
  console.log(`Found ${pages.length} published post${pages.length !== 1 ? 's' : ''}`);

  if (!pages.length) {
    console.log('Nothing to sync — mark a post as ✅ Published in Notion to go live.');
    // Still write an empty blog index so /blog/ works
    mkdirSync(join(process.cwd(), 'blog'), { recursive: true });
    writeFileSync(join(process.cwd(), 'blog', 'index.html'), blogIndexPage([]), 'utf8');
    return;
  }

  const postList = [];

  for (const page of pages) {
    const p    = page.properties;
    const title       = p['Post Title']?.title?.[0]?.plain_text || 'Untitled';
    const keyword     = p['Target Keyword']?.rich_text?.[0]?.plain_text || '';
    const publishDate = p['Publish Date']?.date?.start || '';
    const funnelStage = p['Funnel Stage']?.select?.name || '';
    const slug        = slugify(title);
    const liveUrl     = `${SITE_DOMAIN}/blog/${slug}/`;

    console.log(`\n📝 "${title}"`);

    const blocks  = await getPageBlocks(page.id);
    const content = blocksToHtml(blocks);

    const dir = join(process.cwd(), 'blog', slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), postPage({ title, keyword, publishDate, funnelStage, content }), 'utf8');
    console.log(`   ✓ /blog/${slug}/index.html`);

    try {
      await updateLiveUrl(page.id, liveUrl);
      console.log(`   ✓ Live URL set in Notion → ${liveUrl}`);
    } catch (e) {
      console.warn(`   ⚠ Couldn't update Live URL: ${e.message}`);
    }

    postList.push({ title, slug, keyword, funnelStage, publishDate });
  }

  mkdirSync(join(process.cwd(), 'blog'), { recursive: true });
  writeFileSync(join(process.cwd(), 'blog', 'index.html'), blogIndexPage(postList), 'utf8');
  console.log(`\n✓ /blog/index.html (${postList.length} post${postList.length !== 1 ? 's' : ''})`);
  console.log('\n✅ Done!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
