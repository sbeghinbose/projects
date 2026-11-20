import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
const assets={};for(const name of ['index.html','staff.html','student.html','app.js'])assets['/'+name]=readFileSync('public/'+name,'utf8');assets['/']=assets['/index.html'];writeFileSync('assets.json',JSON.stringify(assets));
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
await build({entryPoints:['worker/index.js'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'dist/server/index.js',external:['crypto'],minify:false});
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built Worker, embedded frontend, and 500 questions.');
