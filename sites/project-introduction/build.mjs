import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateArchitecture } from './content/architecture-translations.mjs';
import { drawDiagrams } from './content/draw-diagrams.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const publicUrl = 'https://haginot.github.io/aip-oss-platform/';
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = s => esc(s).replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2">$1</a>').replace(/`([^`]+)`/g, '<code>$1</code>');
const languages = {
  ja: {html:'ja.html',md:'PROJECT_INTRODUCTION.ja.md',other:'/',otherLabel:'English',title:'業務の意味と実行ルールを、自分たちで持つ。',subtitle:'AIP-OSS Platformが目指す、交換可能な技術で作るAI業務基盤',description:'開発の動機、全体アーキテクチャ、PostgreSQLの役割、交換可能性、認可とAI、検証の現在地。企業が業務の定義を持つためのAIP-OSS Platform紹介記事。',contents:'この記事の内容',read:'本文へ進む',map:'全体図を原寸で開く',source:'Markdownで読む',status:'開発中のプロジェクト',date:'記録確認・改稿：2026年10月13日',back:'先頭へ戻る',language:'言語を選ぶ',figure:'図を原寸で開く',table:'横にスクロールして表全体を読めます',note:'目標設計・参照実装・検証記録を区別して紹介しています。',footer:'業務の定義を残して、技術を選び直せる。'},
  en: {html:'index.html',md:'PROJECT_INTRODUCTION.md',other:'/ja',otherLabel:'日本語',title:'Your business semantics. Your rules.',subtitle:'AIP-OSS Platform: an AI business platform built from replaceable technologies',description:'Why AIP-OSS exists, its target architecture, the role of PostgreSQL, alternatives, AI authorization, recovery, and the limits of the current verification evidence.',contents:'In this article',read:'Start reading',map:'Open the full architecture map',source:'Read as Markdown',status:'A project in development',date:'Records inspected and article revised: October 13, 2026',back:'Back to top',language:'Choose language',figure:'Open full-resolution diagram',table:'Scroll horizontally to read the complete table',note:'Target design, reference implementation, and verification records are presented separately.',footer:'Keep the business definitions. Choose the technology again.'},
};

languages.ja.other = 'index.html';
languages.en.other = 'ja.html';

function render(markdown, lang) {
  const config=languages[lang];
  const blocks=markdown.trim().split(/\n\s*\n/);
  const intro=[], sections=[]; let current=null;
  for(const block of blocks) {
    if(block.startsWith('# ')) continue;
    if(block.startsWith('## ')) {
      const heading=block.slice(3); const match=heading.match(/^(\d{2}) (.*)$/);
      current={id:match?`section-${match[1]}`:'references',number:match?.[1],title:match?.[2]??heading,body:[]}; sections.push(current); continue;
    }
    const target=current?current.body:intro;
    const fig=block.match(/^!\[([^\]]+)\]\(([^\s]+) "([^"]+)"\)$/);
    if(fig) {
      const [,alt,src,caption]=fig; const map=src.includes('/architecture/');
      const dimensions=readFileSync(path.join(dist,src),'utf8').match(/viewBox="0 0 (\d+) (\d+)"/);
      if(!dimensions)throw new Error(`Missing SVG dimensions: ${src}`);
      target.push(`<figure class="${map?'architecture':'detail-figure'}"><a href="${src}" target="_blank" rel="noopener" aria-label="${config.figure}: ${esc(alt)}"><img src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async" width="${dimensions[1]}" height="${dimensions[2]}"></a><figcaption><span class="figure-mark">${map?'ARCHITECTURE':'REFERENCE FLOW'}</span>${inline(caption)} <a href="${src}" target="_blank" rel="noopener">${config.figure} ↗</a></figcaption></figure>`);
    } else if(block.startsWith('|')) {
      const rows=block.split('\n').map(row=>row.split('|').slice(1,-1).map(c=>c.trim()));
      const header=rows.shift(); rows.shift();
      target.push(`<div class="table-wrap" role="region" tabindex="0" aria-label="${esc(current.title)} — ${config.table}"><table><thead><tr>${header.map(c=>`<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>i===0?`<th scope="row">${inline(c)}</th>`:`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else {
      target.push(`<p>${inline(block.replaceAll('\n',' '))}</p>`);
    }
  }
  const toc=sections.filter(s=>s.number).map(s=>`<li><a href="#${s.id}"><span>${s.number}</span>${esc(s.title)}</a></li>`).join('');
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(config.description)}"><meta name="theme-color" content="#ffffff"><title>${esc(config.title)} | AIP-OSS Platform</title><link rel="canonical" href="https://aip-oss-platform-visual-guide.hagino528644.chatgpt.site${lang==='ja'?'/ja':'/'}"><link rel="alternate" hreflang="ja" href="https://aip-oss-platform-visual-guide.hagino528644.chatgpt.site/ja"><link rel="alternate" hreflang="en" href="https://aip-oss-platform-visual-guide.hagino528644.chatgpt.site/"><link rel="stylesheet" href="/article.css"></head>
<body id="top"><a class="skip" href="#article">${config.read}</a>
<nav class="site-nav" aria-label="${config.language}"><a class="wordmark" href="${lang==='ja'?'/ja':'/'}">AIP<span>—</span>OSS <small>PLATFORM</small></a><div class="nav-right"><span class="nav-label">ENGINEERING / 01</span><a class="language" href="${config.other}" lang="${lang==='ja'?'en':'ja'}">${config.otherLabel} <span aria-hidden="true">↗</span></a></div></nav>
<main><article id="article"><header class="hero"><div class="eyebrow">THE IDEA BEHIND AIP-OSS</div><h1>${lang==='ja'?'<span class="title-line"><span class="title-phrase">業務の意味と</span><span class="title-phrase">実行ルールを、</span></span><span class="title-line title-phrase">自分たちで持つ。</span>':esc(config.title)}</h1><p class="subtitle">${esc(config.subtitle)}</p><div class="meta"><span class="status"><i aria-hidden="true"></i>${config.status}</span><time datetime="2026-10-13">${config.date}</time></div></header>
<div class="intro prose">${intro.join('\n')}</div>
<div class="reading-tools prose"><a href="#section-03">${lang==='ja'?'アーキテクチャを見る':'Explore the architecture'} <span aria-hidden="true">↓</span></a><a href="${config.md}">${config.source} <span aria-hidden="true">↗</span></a></div>
<nav class="contents" aria-label="${config.contents}"><div class="contents-heading">${config.contents}<span>01 — 10</span></div><ol>${toc}</ol></nav>
${sections.map(s=>`<section class="chapter ${s.id==='references'?'references':''}" aria-labelledby="${s.id}"><div class="chapter-heading">${s.number?`<span class="chapter-number">${s.number}</span>`:''}<h2 id="${s.id}">${esc(s.title)}</h2></div><div class="chapter-body">${s.body.join('\n')}</div></section>`).join('\n')}
<footer class="article-footer"><p>${config.footer}</p><div><a href="${config.md}">${config.source}</a><a href="${config.other}" lang="${lang==='ja'?'en':'ja'}">${config.otherLabel}</a><a href="#top">${config.back} ↑</a></div><small>${config.note}</small></footer></article></main></body></html>\n`;
}

await mkdir(path.join(dist,'assets/architecture'),{recursive:true});
await cp(path.join(root,'content/assets'),path.join(dist,'assets'),{recursive:true});
await cp(path.join(root,'content/reference'),path.join(dist,'reference'),{recursive:true});
await translateArchitecture(dist);
await drawDiagrams(dist);
await copyFile(path.join(root,'content/article.css'),path.join(dist,'article.css'));
for(const [lang,config] of Object.entries(languages)) {
  const markdown=await readFile(path.join(root,'content',`${lang}.md`),'utf8');
  const html=render(markdown,lang)
    .replaceAll('https://aip-oss-platform-visual-guide.hagino528644.chatgpt.site/ja', `${publicUrl}ja.html`)
    .replaceAll('https://aip-oss-platform-visual-guide.hagino528644.chatgpt.site/', publicUrl)
    .replaceAll('href="/article.css"', 'href="article.css"')
    .replaceAll('href="/ja"', 'href="ja.html"')
    .replaceAll('href="/"', 'href="index.html"');
  await writeFile(path.join(dist,config.html),html);
  await writeFile(path.join(dist,config.md),markdown);
  if(process.argv.includes('--sync-docs')) {
    const docs=path.resolve(root,'../../docs');
    await writeFile(path.join(docs,config.md),markdown.replaceAll('](reference/PRODUCT_GOAL','](../PRODUCT_GOAL').replaceAll('](reference/IMPLEMENTATION_SNAPSHOT.md)','](../sites/project-introduction/dist/reference/IMPLEMENTATION_SNAPSHOT.md)').replaceAll('](reference/',']('));
    let local=html.replaceAll('href="/article.css"','href="assets/project-introduction/article.css"');
    local=local.replaceAll('href="/ja"','href="PROJECT_INTRODUCTION.ja.html"').replaceAll('href="/"','href="PROJECT_INTRODUCTION.html"');
    local=local.replaceAll('href="reference/PRODUCT_GOAL','href="../PRODUCT_GOAL').replaceAll('href="reference/IMPLEMENTATION_SNAPSHOT.md"','href="../sites/project-introduction/dist/reference/IMPLEMENTATION_SNAPSHOT.md"').replaceAll('href="reference/','href="');
    await writeFile(path.join(docs,lang==='ja'?'PROJECT_INTRODUCTION.ja.html':'PROJECT_INTRODUCTION.html'),local);
    await copyFile(path.join(dist,'article.css'),path.join(docs,'assets/project-introduction/article.css'));
    for(const suffix of ['', '.en'])for(const kind of ['clean','detail'])await copyFile(path.join(dist,`assets/architecture/aip-oss-architecture-${kind}${suffix}.svg`),path.join(docs,`assets/architecture/aip-oss-architecture-${kind}${suffix}.svg`));
    for(const suffix of ['', '.ja'])for(const kind of ['recall-flow','proposal-authority','unknown-success'])await copyFile(path.join(dist,`assets/project-introduction/${kind}${suffix}.svg`),path.join(docs,`assets/project-introduction/${kind}${suffix}.svg`));
  }
}
if(process.argv.includes('--github-pages')) {
  // Copy only this site's generated files; preserve the repository's other docs.
  const pages = path.resolve(root, '../../docs');
  await cp(dist, pages, {recursive:true});
  await writeFile(path.join(pages, '.nojekyll'), '');
}
console.log('Built both language editions, Markdown downloads, and bilingual architecture maps.');
