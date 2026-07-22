import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const carbone = require('carbone');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'templates', 'report-template.docx');
const output = path.join(root, '.tmp', 'template-smoke-output.docx');
const zip = await JSZip.loadAsync(await readFile(template));
const imageFile = Object.keys(zip.files).find((name) => name.startsWith('word/media/') && name.endsWith('.png'));
const image = imageFile ? `data:image/png;base64,${(await zip.file(imageFile).async('nodebuffer')).toString('base64')}` : '';
const blankImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcO7WQAAAABJRU5ErkJggg==';
const data = { title:'Cao xạ đen 1 neg - Smoke Test', rows: [
  { stt:1, rt:'12,02', ten_hoat_chat:'CAFFEIC ACID', ion:'[M-H]-', mz_precursor:'179.034', mz_fragments:'135 (100)', cong_thuc:'C9H8O4', sai_so_ppm:'2.21594', cau_truc:image },
  { stt:2, rt:'2,03', ten_hoat_chat:'Glutamic acid', ion:'M+H', mz_precursor:'190.07', mz_fragments:'59, 85 (100), 191', cong_thuc:'C7H11NO5', sai_so_ppm:'5185.35', cau_truc:blankImage },
] };
const rendered = await new Promise((resolve, reject) => carbone.render(template, data, (error, result) => error ? reject(error) : resolve(result)));
await mkdir(path.dirname(output), { recursive:true });
await writeFile(output, rendered);
const renderedZip = await JSZip.loadAsync(rendered);
const xml = await renderedZip.file('word/document.xml').async('string');
const rows = (xml.match(/<w:tr(?:\s[^>]*)?>/g) || []).length;
const tags = (xml.match(/\{d\./g) || []).length;
const hasTitle = xml.includes('Cao xạ đen 1 neg - Smoke Test');
const images = Object.keys(renderedZip.files).filter(name => name.startsWith('word/media/') && !renderedZip.files[name].dir).length;
const inlineDrawings = (xml.match(/<wp:inline/g) || []).length;
console.log(JSON.stringify({ output:path.relative(root,output), bytes:rendered.length, tableRows:rows, remainingTags:tags, titleRendered:hasTitle, inlineDrawings, mediaFiles:images }, null, 2));
