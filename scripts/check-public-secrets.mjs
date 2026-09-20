import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const sourceMode=process.argv.includes('--source');
const root=sourceMode?'.':'dist';
if(!existsSync(root))throw new Error('Build dist/ before checking public artifacts.');
const privateEnv=existsSync('.env.server.local')?parseEnv(readFileSync('.env.server.local','utf8')):{};
const secrets=Object.entries(privateEnv).filter(([name,value])=>!name.startsWith('VITE_') && /(?:SECRET|SERVICE_ROLE|API_KEY|PASSWORD|ACCESS_TOKEN)/.test(name) && value.length>=12);
const failures=[];
let filesChecked=0;
function inspect(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);
  if(entry.isDirectory()){inspect(file);continue;}
  if(!/\.(?:js|mjs|css|html|json|txt|map)$/.test(file)&&!['_headers','_redirects'].includes(entry.name))continue;
  inspectFile(file);
 }
}
function inspectFile(file){
  filesChecked++;
  const source=readFileSync(file,'utf8');
  for(const [name,value] of secrets)if(source.includes(value))failures.push({file:relative(root,file),reason:`configured server credential: ${name}`});
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}/.test(source))failures.push({file:relative(root,file),reason:'private key block'});
  if(/cfut_[A-Za-z0-9_-]{35,}/.test(source))failures.push({file:relative(root,file),reason:'Cloudflare API credential'});
  if(/sk-proj-[A-Za-z0-9_-]{40,}/.test(source))failures.push({file:relative(root,file),reason:'OpenAI project credential'});
  for(const token of source.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){
   try{if(JSON.parse(Buffer.from(token[1],'base64url').toString()).role==='service_role')failures.push({file:relative(root,file),reason:'service-role JWT'});}catch{/* Non-JWT source text is ignored. */}
  }
}
if(sourceMode){
 const candidates=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 for(const file of new Set(candidates))if(existsSync(file)&&! /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|zip)$/i.test(file))inspectFile(file);
}else inspect(root);
// Only filenames and key names are logged; matched secret values never leave memory.
if(failures.length){console.error(JSON.stringify({status:'FAILED',failures},null,2));process.exitCode=1;}
else console.log(JSON.stringify({status:'PASSED',filesChecked,configuredServerCredentialsChecked:secrets.length,scope:sourceMode?'Git candidate text files (ignored files excluded).':'Public build text artifacts.'}));
