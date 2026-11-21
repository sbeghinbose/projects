import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
await build({entryPoints:['ui/importer.js'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:'public/importer.js',minify:true});
const assets={};for(const name of readdirSync('public').filter(n=>/\.(html|js|css)$/.test(n)))assets['/'+name]=readFileSync('public/'+name,'utf8');assets['/']=assets['/index.html'];writeFileSync('assets.json',JSON.stringify(assets));
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
await build({entryPoints:['worker/index.js'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'dist/server/index.js',external:['crypto'],loader:{'.ttf':'binary'},minify:false});
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built Worker and embedded frontend; schema migrations include the complete question bank.');
