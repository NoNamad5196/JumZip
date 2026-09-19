import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--after' || !/^\d{12}$/.test(args[1])))throw new Error('Usage: node scripts/prepare-migrations.mjs [--after 12-digit-last-applied-version]');
const after=args[1];
const allFiles=readdirSync('supabase/migrations').filter(x=>/^\d+_.*\.sql$/.test(x)).sort();
if(after && !allFiles.some(file=>file.startsWith(`${after}_`)))throw new Error('The expected last applied migration is not present locally.');
const files=allFiles.filter(file=>!after || file.split('_')[0]>after);
if(!files.length)throw new Error('No pending migrations to prepare.');
let sql="begin;\nselect pg_advisory_xact_lock(hashtextextended('jumzip-schema-migrations',0));\ncreate schema if not exists supabase_migrations;\ncreate table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);\n";
sql+=after
 ? `do $guard$ begin if (select max(version) from supabase_migrations.schema_migrations) is distinct from '${after}' then raise exception 'Migration history differs from expected ${after}; inspect history before applying'; end if; end $guard$;\n`
 : "do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations) or to_regclass('public.profiles') is not null then raise exception 'Initial migration requires an empty JumZip project'; end if; end $guard$;\n";
for(const file of files){
 const [version,...parts]=file.replace(/\.sql$/,'').split('_');
 const source=readFileSync(`supabase/migrations/${file}`,'utf8');
 if(source.includes('$jumzip_migration$'))throw new Error('Dollar delimiter collision');
 sql+=`${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${parts.join('_')}',array[$jumzip_migration$${source}$jumzip_migration$]);\n`;
}
sql+='commit;\n'; mkdirSync('supabase/.temp',{recursive:true});
const output=`supabase/.temp/${after ? 'pending' : 'initial'}-migrations.sql`;
writeFileSync(output,sql);console.log(`Prepared ${files.length} migrations at ${resolve(output)}. Expected remote history: ${after ?? 'empty project'}.`);
