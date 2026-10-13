import assert from 'node:assert/strict';
import {readFile, access, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {palette} from './content/draw-diagrams.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const dist=path.join(root,'dist');
let checked=0;
for(const [file,lang] of [['index.html','en'],['ja.html','ja']]) {
  const html=await readFile(path.join(dist,file),'utf8');
  assert(html.includes(`<html lang="${lang}">`));
  assert.equal((html.match(/<h1>/g)||[]).length,1);
  assert.equal((html.match(/<h2 /g)||[]).length,11);
  assert.equal((html.match(/<figure /g)||[]).length,4);
  assert(!/<script\b|\son\w+=|(?:href|src)="(?:javascript:|data:)/i.test(html));
  assert(html.includes('READY_FOR_REVIEW'));
  assert(html.includes('2026-10-13'));
  assert(html.includes('https://haginot.github.io/aip-oss-platform/'));
  assert(html.includes('https://github.com/haginot/aip-oss-platform'));
  assert(!html.includes('chatgpt.site'));
  assert(!/(?:href|src)="\//.test(html), 'Use relative paths for project Pages');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  for(const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if(url.startsWith('https://'))continue;
    if(url.startsWith('#')) {assert(ids.has(url.slice(1)),`${file}: missing anchor ${url}`);continue;}
    const normalized=url==='/'?'index.html':url==='/ja'?'ja.html':url.replace(/^\//,'');
    const target=path.resolve(dist,normalized);
    assert(target.startsWith(dist+path.sep),`Unsafe path: ${url}`);
    await access(target);checked++;
  }
  for(const img of html.matchAll(/<img\b([^>]+)>/g))assert(/alt="[^"]+"/.test(img[1]));
}
for(const lang of ['ja','en']) {
  const markdown=await readFile(path.join(root,`content/${lang}.md`),'utf8');
  assert(markdown.length>7000,`${lang}: full-length content missing`);
  assert.equal((markdown.match(/^## \d{2} /gm)||[]).length,10);
}
const svg=await readFile(path.join(dist,'assets/architecture/aip-oss-architecture-clean.en.svg'),'utf8');
assert(svg.includes('viewBox="0 0 1800 2100"'));
assert(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(svg.replace(/font-family="[^"]*"/g,'')),'Untranslated Japanese in English map');
async function scan(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if(entry.isDirectory())await scan(filename);
    else {
      const text=await readFile(filename,'utf8');
      assert(!/\/Users\/|ghp_[A-Za-z0-9]+|github_pat_|Bearer\s+[A-Za-z0-9_-]{15,}/.test(text),`Local path or credential-like content: ${filename}`);
    }
  }
}
await scan(dist);
const allowedColors=new Set(Object.values(palette));
for(const lang of ['ja','en']) {
  const filenames=[`architecture/aip-oss-architecture-clean${lang==='en'?'.en':''}.svg`,`architecture/aip-oss-architecture-detail${lang==='en'?'.en':''}.svg`,...['recall-flow','proposal-authority','unknown-success'].map(name=>`project-introduction/${name}${lang==='ja'?'.ja':''}.svg`)];
  for(const name of filenames){
    const source=await readFile(path.join(dist,'assets',name),'utf8');
    assert(source.includes('<svg')&&source.endsWith('</svg>\n'),`Invalid SVG wrapper: ${name}`);
    for(const [,color] of source.matchAll(/(#[A-Fa-f0-9]{6})/g))assert(allowedColors.has(color),`Non-Canly color ${color}: ${name}`);
    if(lang==='en')assert(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(source.replace(/font-family="[^"]*"/g,'')),`Untranslated English figure: ${name}`);
  }
}
console.log(`PASS: bilingual content, headings, 4 figures/edition, ${checked} local links/assets, English map, GitHub Pages paths, and sensitive-output checks.`);
