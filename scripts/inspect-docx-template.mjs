import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'imports', 'Cao_xa_den_1_neg.source.docx');
const zip = await JSZip.loadAsync(await readFile(source));
const xml = await zip.file('word/document.xml').async('string');
const decode = (value) => value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const textOf = (fragment) => decode([...fragment.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join(''));
const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(match => textOf(match[0])).filter(Boolean);
const tables = [...xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].map((table, tableIndex) => ({
  table: tableIndex + 1,
  rows: [...table[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map((row, rowIndex) => ({
    row: rowIndex + 1,
    cells: [...row[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(cell => textOf(cell[0])),
  })),
}));
const sections = [...xml.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(section => ({
  pageSize: section[0].match(/<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*?(?:w:orient="([^"]+)")?/)?.slice(1),
  margins: section[0].match(/<w:pgMar[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/)?.slice(1),
}));
const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name].dir);
const tableGrid = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map(match => [...match[1].matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g)].map(item => Number(item[1])));
const fonts = [...new Set([...xml.matchAll(/<w:rFonts[^>]*w:ascii="([^"]+)"/g)].map(match => match[1]))];
const fontSizes = [...new Set([...xml.matchAll(/<w:sz[^>]*w:val="(\d+)"/g)].map(match => Number(match[1])/2))].sort((a,b)=>a-b);
const drawingMode = { inline:(xml.match(/<wp:inline/g)||[]).length, anchor:(xml.match(/<wp:anchor/g)||[]).length };
const headers = await Promise.all(Object.keys(zip.files).filter(name => /^word\/header\d+\.xml$/.test(name)).map(async name => ({ name, text:textOf(await zip.file(name).async('string')) })));
const footers = await Promise.all(Object.keys(zip.files).filter(name => /^word\/footer\d+\.xml$/.test(name)).map(async name => ({ name, text:textOf(await zip.file(name).async('string')) })));
console.log(JSON.stringify({ parts:Object.keys(zip.files).length, paragraphs, tables, sections, tableGrid, fonts, fontSizes, drawingMode, media, headers, footers }, null, 2));
