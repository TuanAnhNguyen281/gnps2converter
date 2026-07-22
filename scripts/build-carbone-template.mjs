import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'imports', 'Cao_xa_den_1_neg.source.docx');
const outputPath = path.join(root, 'templates', 'report-template.docx');
const zip = await JSZip.loadAsync(await readFile(sourcePath));
const documentFile = zip.file('word/document.xml');
if (!documentFile) throw new Error('word/document.xml not found');
let xml = await documentFile.async('string');

function cellsOf(row) {
  return [...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)];
}

function replaceCellTexts(cell, values) {
  let index = 0;
  return cell.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g, (_full, open, close) => `${open}${values[index++] ?? ''}${close}`);
}

function patchPatternRow(row) {
  const cells = cellsOf(row);
  if (cells.length !== 8) throw new Error(`Expected 8 cells in pattern row, found ${cells.length}`);
  const replacements = [
    ['{d.rows[i].stt}'], ['{d.rows[i].rt}'], ['{d.rows[i].ten_hoat_chat}'], ['{d.rows[i].ion}'],
    ['{d.rows[i].mz_precursor}'], ['{d.rows[i].mz_fragments}'], ['{d.rows[i].cong_thuc}', '{d.rows[i].sai_so_ppm}'], [],
  ];
  let cursor = 0;
  let output = '';
  for (let i = 0; i < cells.length; i += 1) {
    const match = cells[i];
    output += row.slice(cursor, match.index);
    let cell = replaceCellTexts(match[0], replacements[i]);
    if (i === 6) {
      const ppmTag = '{d.rows[i].sai_so_ppm}';
      const ppmPosition = cell.indexOf(ppmTag);
      const textStart = cell.lastIndexOf('<w:t', ppmPosition);
      if (ppmPosition >= 0 && textStart >= 0) cell = `${cell.slice(0, textStart)}<w:br/>${cell.slice(textStart)}`;
      const updatedPpmPosition = cell.indexOf(ppmTag);
      const runStart = cell.lastIndexOf('<w:r ', updatedPpmPosition);
      const runEnd = cell.indexOf('</w:r>', updatedPpmPosition);
      if (runStart >= 0 && runEnd >= 0) {
        const ppmRun = cell.slice(runStart, runEnd + 6)
          .replace(/<w:vertAlign\s+w:val="subscript"\s*\/>/g, '<w:vertAlign w:val="baseline"/>');
        cell = `${cell.slice(0, runStart)}${ppmRun}${cell.slice(runEnd + 6)}`;
      }
    }
    if (i === 7) cell = cell.replace(/<wp:docPr([^>]*?)(?:\sdescr="[^"]*")?\s*\/>/, (_full, attrs) => `<wp:docPr${attrs} descr="{d.rows[i].cau_truc}"/>`);
    output += cell;
    cursor = match.index + match[0].length;
  }
  return output + row.slice(cursor);
}

function buildEndRow(patternRow) {
  const cells = cellsOf(patternRow);
  let cursor = 0;
  let output = '';
  for (let i = 0; i < cells.length; i += 1) {
    const match = cells[i];
    output += patternRow.slice(cursor, match.index);
    let cell = match[0].replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '');
    cell = replaceCellTexts(cell, i === 0 ? ['{d.rows[i+1]}'] : ['']);
    output += cell;
    cursor = match.index + match[0].length;
  }
  return output + patternRow.slice(cursor);
}

const titleParagraph = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/);
if (!titleParagraph || titleParagraph.index == null) throw new Error('Template title paragraph not found');
const dynamicTitle = replaceCellTexts(titleParagraph[0], ['{d.title}']);
xml = `${xml.slice(0, titleParagraph.index)}${dynamicTitle}${xml.slice(titleParagraph.index + titleParagraph[0].length)}`;

const tableMatch = xml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/);
if (!tableMatch || tableMatch.index == null) throw new Error('Template table not found');
const table = tableMatch[0];
const rows = [...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];
if (rows.length < 2) throw new Error('Template requires a header and at least one data row');
const header = rows[0];
const patternRow = patchPatternRow(rows[1][0]);
const endRow = buildEndRow(patternRow);
const prefix = table.slice(0, header.index + header[0].length);
const last = rows[rows.length - 1];
const suffix = table.slice(last.index + last[0].length);
const patchedTable = `${prefix}${patternRow}${endRow}${suffix}`;
xml = `${xml.slice(0, tableMatch.index)}${patchedTable}${xml.slice(tableMatch.index + table.length)}`;

zip.file('word/document.xml', xml);
const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
await writeFile(outputPath, output);
console.log(`Created ${path.relative(root, outputPath)} (${output.length} bytes)`);
