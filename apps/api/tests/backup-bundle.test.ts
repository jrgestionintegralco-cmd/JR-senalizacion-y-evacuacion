import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyBundle, restoreBundle } from '../../../infra/backup/bundle.mjs';

const directories: string[] = [];
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jr-backup-test-')); directories.push(directory);
  await mkdir(join(directory,'objects'));
  const key = 'org/plans/sealed/test'; const name = hash(key)+'.bin';
  await writeFile(join(directory,'objects',name),'file');
  await writeFile(join(directory,'database.dump'),'dump');
  const manifest = {format:'jr-backup-v1',source:{database:'source',bucket:'source-bucket'},databaseSha256:hash('dump'),objects:[{fileId:'file',key,name,size:4,sha256:hash('file')}]};
  const bytes = JSON.stringify(manifest);
  await writeFile(join(directory,'manifest.json'),bytes);
  await writeFile(join(directory,'COMPLETE.sha256'),hash(bytes));
  return {directory,manifest,name};
}
afterEach(async()=>{ for(const directory of directories.splice(0)) await rm(directory,{recursive:true,force:true}); });
describe('integridad de respaldos',()=>{
  it('verifica manifiesto, base de datos y archivo',async()=>{
    const f=await fixture(); expect((await verifyBundle(f.directory)).objects).toHaveLength(1);
  });
  it('rechaza archivo alterado',async()=>{
    const f=await fixture(); await writeFile(join(f.directory,'objects',f.name),'fake');
    await expect(verifyBundle(f.directory)).rejects.toThrow('object integrity');
  });
  it('rechaza dump alterado',async()=>{
    const f=await fixture(); await writeFile(join(f.directory,'database.dump'),'fake');
    await expect(verifyBundle(f.directory)).rejects.toThrow('Database integrity');
  });
  it('rechaza manifiesto alterado',async()=>{
    const f=await fixture(); await writeFile(join(f.directory,'manifest.json'),'{}');
    await expect(verifyBundle(f.directory)).rejects.toThrow('Manifest integrity');
  });
  it('rechaza rutas que salen del directorio incluso con manifiesto recalculado',async()=>{
    const f=await fixture(); f.manifest.objects[0].name='../escape'; const bytes=JSON.stringify(f.manifest);
    await writeFile(join(f.directory,'manifest.json'),bytes); await writeFile(join(f.directory,'COMPLETE.sha256'),hash(bytes));
    await expect(verifyBundle(f.directory)).rejects.toThrow('Invalid object manifest');
  });
  it('rechaza respaldo incompleto',async()=>{
    const f=await fixture(); await rm(join(f.directory,'COMPLETE.sha256'));
    await expect(verifyBundle(f.directory)).rejects.toThrow();
  });
  it('impide restaurar encima de la base de origen antes de conectar',async()=>{
    const f=await fixture();
    await expect(restoreBundle({directory:f.directory,dbUrl:'postgresql://user:secret@unused/source',storage:{bucket:'new-bucket'}})).rejects.toThrow('DIFFERENT');
  });
  it('impide restaurar encima del bucket de origen antes de conectar',async()=>{
    const f=await fixture();
    await expect(restoreBundle({directory:f.directory,dbUrl:'postgresql://user:secret@unused/new',storage:{bucket:'source-bucket'}})).rejects.toThrow('DIFFERENT');
  });
});
