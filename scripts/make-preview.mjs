import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'frontend','dist-demo');
const compiledAssets = await readdir(path.join(dist, 'assets'));
if (compiledAssets.filter(name => name.endsWith('.js')).length !== 1 || compiledAssets.filter(name => name.endsWith('.css')).length !== 1)
  throw new Error('Demo must be built as one JavaScript entry and one stylesheet before inlining.');
let html=await readFile(path.join(dist,'index.html'),'utf8');
const assetPath=p=>path.join(dist,p.replace(/^\.?\//,''));
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
if(scripts.length!==1)throw new Error(`Expected one bundled JS entry; found ${scripts.length}. Update this packaging step if code splitting changes.`);
let js=await readFile(assetPath(scripts[0][1]),'utf8');
let css='';
for(const match of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)){
  const href=match[0].match(/href="([^"]+)"/);if(!href)continue;
  css+='\n'+await readFile(assetPath(href[1]),'utf8');html=html.replace(match[0],'');
}
const mime={'.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function inlineDirectory(dir,relative=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const rel=path.posix.join(relative,entry.name);const abs=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='assets')await inlineDirectory(abs,rel);continue;}
    const type=mime[path.extname(entry.name)];if(!type)continue;
    const data=`data:${type};base64,${(await readFile(abs)).toString('base64')}`;
    for(const url of [`/${rel}`,`./${rel}`,`../${rel}`]){
      js=js.split(`"${url}"`).join(`"${data}"`).split(`'${url}'`).join(`'${data}'`).split('`'+url+'`').join('`'+data+'`');
      css=css.split(`url("${url}")`).join(`url("${data}")`).split(`url('${url}')`).join(`url('${data}')`).split(`url(${url})`).join(`url(${data})`);
      html=html.split(`"${url}"`).join(`"${data}"`);
    }
  }
}
await inlineDirectory(dist);
// Replacement callbacks preserve literal dollar patterns inside compiled JavaScript.
html=html.replace(scripts[0][0],()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);
html=html.replace('</head>',()=>`<style>${css}</style></head>`);
html=html.replace(/<link\b[^>]*\brel="(?:modulepreload|manifest)"[^>]*>/g,'');
html=html.replace(/<title>.*?<\/title>/,'<title>Workspace — Interactive Demo</title>');
await writeFile(path.join(root,'preview.html'),html);
console.log(`Created preview.html (${Buffer.byteLength(html).toLocaleString()} bytes). All required scripts, styles, fonts and branding are embedded.`);
