import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const gnps = await fetch('http://localhost:8787/api/structures/gnps2', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: 'https://gnps2.org/result?task=04eeeef3ed1d42cba62920ed69e7319e&viewname=librarymatches',
    rows: [{ id: 'verify-image', compoundName: 'MALIC ACID' }],
  }),
}).then((response) => response.json());
const dataUri = gnps.resolved?.[0]?.structureData;
if (!dataUri) throw new Error('GNPS2 image not found');
const source = Buffer.from(dataUri.split(',')[1], 'base64');
const response = await fetch('http://localhost:8787/api/export/docx', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Image identity test', rows: [{ id: 'verify-image', selected: true, compoundName: 'MALIC ACID', structureData: dataUri }] }),
});
if (!response.ok) throw new Error(await response.text());
const docx = Buffer.from(await response.arrayBuffer());
await writeFile('.tmp/gnps-image-verified.docx', docx);
const zip = await JSZip.loadAsync(docx);
const documentXml = await zip.file('word/document.xml').async('string');
const relationsXml = await zip.file('word/_rels/document.xml.rels').async('string');
const relationId = documentXml.match(/<a:blip[^>]*r:embed="([^"]+)/)?.[1];
const target = relationsXml.match(new RegExp(`Id="${relationId}"[^>]*Target="([^"]+)`))?.[1];
const embedded = target ? await zip.file(`word/${target}`).async('nodebuffer') : undefined;
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const pngSize = (buffer) => buffer?.subarray(1, 4).toString() === 'PNG'
  ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } : undefined;
console.log(JSON.stringify({ relationId, target, sourceBytes: source.length, embeddedBytes: embedded?.length, sourceSize: pngSize(source), embeddedSize: pngSize(embedded), sourceHash: hash(source), embeddedHash: embedded && hash(embedded), identical: embedded && hash(source) === hash(embedded) }, null, 2));
