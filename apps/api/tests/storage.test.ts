import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createStorage } from '../src/storage.js';
import { loadConfig } from '../src/config.js';

const config=loadConfig({DATABASE_URL:'postgresql://unused',S3_ENDPOINT:'http://unused:9000',S3_PUBLIC_ENDPOINT:'http://unused:9000',S3_BUCKET:'test-bucket',S3_ACCESS_KEY:'test-access',S3_SECRET_KEY:'test-secret',S3_FORCE_PATH_STYLE:'true'});
afterEach(()=>vi.restoreAllMocks());
describe('almacenamiento verificado',()=>{
  it('firma longitud y tipo sin fijar checksum de un cuerpo vacío',async()=>{
    const url=new URL(await createStorage(config).createUploadUrl('staging/test','image/png',12));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
  });
  it('incluye no-store en la descarga firmada',async()=>{
    const url=new URL(await createStorage(config).createDownloadUrl('sealed/test','test.png'));
    expect(url.searchParams.get('response-cache-control')).toContain('no-store');
  });
  it('sella bytes reales en clave nueva y verifica su lectura',async()=>{
    const png=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
    const puts:any[]=[];
    vi.spyOn(S3Client.prototype,'send').mockImplementation(async(command:any)=>{
      if(command instanceof GetObjectCommand) return {ContentLength:png.length,Body:Readable.from([png])} as any;
      if(command instanceof PutObjectCommand) { puts.push(command.input); return {} as any; }
      throw Error('unexpected request');
    });
    const result=await createStorage(config).finalizePlan('staging/test',png.length,'image/png','org','floor');
    expect(result.objectKey).toMatch(/^org\/plans\/floor\/sealed\//);
    expect(result.checksum).toBe(createHash('sha256').update(png).digest('hex'));
    expect(puts).toHaveLength(1); expect(puts[0].IfNoneMatch).toBe('*');
    expect(puts[0].Body).toEqual(png);
  });
  it('rechaza tamaño distinto antes de publicar un objeto',async()=>{
    vi.spyOn(S3Client.prototype,'send').mockResolvedValue({ContentLength:20,Body:Readable.from([Buffer.alloc(20)])} as never);
    await expect(createStorage(config).finalizePlan('staging/test',10,'image/png','org','floor')).rejects.toMatchObject({code:'SIZE_MISMATCH'});
  });
});
