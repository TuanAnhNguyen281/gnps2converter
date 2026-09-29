import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { MatchRow, RawRow } from './types.js';
import type { MediaInput } from './media/provider.js';
import { ApiError } from './errors.js';
import { emitProgress, type ProgressReporter } from './progress.js';

const TASK_PATTERN = /^[a-f0-9]{32}$/i;
const GNPS_HOSTS = new Set(['gnps2.org', 'www.gnps2.org']);
const MAX_TEXT_BYTES = 30 * 1024 * 1024;

export function extractGnpsTaskId(input: string): string {
  const trimmed = input.trim();
  if (TASK_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  let url: URL;
  try { url = new URL(trimmed); } catch {
    throw new ApiError(400, 'Hãy nhập link GNPS2 hoặc Task ID hợp lệ.', 'GNPS_TASK_INVALID');
  }
  if (!GNPS_HOSTS.has(url.hostname.toLowerCase())) throw new ApiError(400, 'Chỉ chấp nhận link task từ gnps2.org.', 'GNPS_TASK_INVALID');
  const task = url.searchParams.get('task') ?? trimmed.match(/TASK-([a-f0-9]{32})/i)?.[1] ?? '';
  if (!TASK_PATTERN.test(task)) throw new ApiError(400, 'Không tìm thấy Task ID GNPS2 hợp lệ trong đường dẫn.', 'GNPS_TASK_INVALID');
  return task.toLowerCase();
}

async function fetchText(url: string, stage: string, timeoutMs = 25_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new ApiError(502, `Không đọc được ${stage} từ GNPS2 (HTTP ${response.status}). Kiểm tra task có công khai và đã hoàn tất.`, 'GNPS_UPSTREAM_HTTP');
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > MAX_TEXT_BYTES) throw new ApiError(413, 'Tệp GNPS2 vượt quá giới hạn 30 MB.', 'GNPS_FILE_TOO_LARGE');
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new ApiError(413, 'Tệp GNPS2 vượt quá giới hạn 30 MB.', 'GNPS_FILE_TOO_LARGE');
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(504, `GNPS2 phản hồi quá chậm khi đọc ${stage}. Hãy thử lại.`, 'GNPS_TIMEOUT');
    throw new ApiError(502, `Không kết nối được GNPS2 khi đọc ${stage}. Kiểm tra kết nối mạng của backend và thử lại.`, 'GNPS_CONNECTION_FAILED');
  } finally { clearTimeout(timer); }
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return named[entity.toLowerCase()] ?? _match;
  }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseTaskStatus(html: string): { title: string; status: string; workflow: string } {
  const cell = (label: string) => html.match(new RegExp(`<td[^>]*>\\s*${label}\\s*<\\/td>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'))?.[1] ?? '';
  return {
    title: decodeHtml(cell('Description')) || 'GNPS2 Report',
    status: decodeHtml(cell('Status')).toUpperCase(),
    workflow: decodeHtml(cell('Workflow')),
  };
}

const array = <T>(value: T | T[] | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];

export function parseNetworkGraphml(xml: string): Map<string, RawRow> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: false, allowBooleanAttributes: false });
  const parsed = parser.parse(xml) as { graphml?: { key?: unknown; graph?: { node?: unknown } } };
  const root = parsed.graphml as { key?: Record<string, unknown> | Record<string, unknown>[]; graph?: { node?: Record<string, unknown> | Record<string, unknown>[] } } | undefined;
  if (!root?.graph) throw new Error('GraphML GNPS2 không có graph hợp lệ.');
  const keys = new Map(array(root.key).map((key) => [String(key.id), String(key['attr.name'] ?? key.id)]));
  const nodes = new Map<string, RawRow>();
  for (const node of array(root.graph.node)) {
    const row: RawRow = { id: String(node.id ?? '') };
    for (const datum of array(node.data as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      const name = keys.get(String(datum.key)) ?? String(datum.key);
      const value = datum['#text'] ?? '';
      row[name] = typeof value === 'number' ? value : String(value);
    }
    if (row.id) nodes.set(String(row.id), row);
  }
  return nodes;
}

function parseNumber(value: unknown): number {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function splitCompound(value: unknown): { name: string; adduct: string } {
  const raw = String(value ?? '').trim();
  const match = raw.match(/\s+(\[[^\]]+\][+-])\s*$/);
  return { name: match ? raw.slice(0, match.index).trim() : raw, adduct: match?.[1] ?? '' };
}

export function normalizeSourceMetadata(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value == null) return [key, null];
    return [key, typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)];
  }));
}

export function parseMgfFragments(mgf: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const block of mgf.split(/BEGIN IONS/i).slice(1)) {
    const scan = block.match(/^SCANS=(.+)$/mi)?.[1]?.trim() ?? block.match(/^FEATURE_ID=(.+)$/mi)?.[1]?.trim();
    if (!scan) continue;
    const peaks = [...block.matchAll(/^([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)/gm)]
      .map((match) => ({ mz: Number(match[1]), intensity: Number(match[2]) }))
      .filter((peak) => Number.isFinite(peak.mz) && Number.isFinite(peak.intensity));
    const max = Math.max(0, ...peaks.map((peak) => peak.intensity));
    const selected = peaks.sort((a, b) => b.intensity - a.intensity).slice(0, 6).sort((a, b) => a.mz - b.mz);
    result.set(scan, selected.map((peak) => `${peak.mz.toFixed(3).replace(/\.0+$/, '')} (${max ? Math.round(peak.intensity / max * 100) : 0})`).join(', '));
  }
  return result;
}

interface MirrorTable { data?: Array<{ 'm/z'?: number; Intensity?: number }>; selected_rows?: number[] }

export function formatMirrorFragments(table: MirrorTable): string {
  const data = table.data ?? [];
  return (table.selected_rows ?? []).map((index) => {
    const peak = data[index];
    if (!peak || !Number.isFinite(Number(peak['m/z']))) return '';
    const mz = String(Math.trunc(Number(peak['m/z'])));
    return Number(peak.Intensity) >= 0.9995 ? `${mz} (100)` : mz;
  }).filter(Boolean).join(', ');
}

async function mirrorFragments(task: string, scan: string, spectrumId: unknown, captures?: unknown[]): Promise<string> {
  const accession = String(spectrumId ?? '').trim();
  if (!scan || !accession) return '';
  const usi1 = `mzspec:GNPS2:TASK-${task}-nf_output/clustering/specs_ms.mgf:scan:${scan}`;
  const usi2 = `mzspec:GNPS:GNPS-LIBRARY:accession:${accession}`;
  const output = '..peak_table1.columns...peak_table1.data...peak_table1.selected_rows...peak_table2.columns...peak_table2.data...peak_table2.selected_rows..';
  const outputs = [
    ['peak_table1', 'columns'], ['peak_table1', 'data'], ['peak_table1', 'selected_rows'],
    ['peak_table2', 'columns'], ['peak_table2', 'data'], ['peak_table2', 'selected_rows'],
  ].map(([id, property]) => ({ id, property }));
  const search = `?usi1=${encodeURIComponent(usi1)}&usi2=${encodeURIComponent(usi2)}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('https://metabolomics-usi.gnps2.org/dashinterface/_dash-update-component', {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        output, outputs, changedPropIds: ['usi1.value', 'usi2.value'],
        inputs: [
          { id: 'usi1', property: 'value', value: usi1 }, { id: 'usi2', property: 'value', value: usi2 },
          { id: 'mz_min', property: 'value', value: null }, { id: 'mz_max', property: 'value', value: null },
          { id: 'annotate_precision', property: 'value', value: 4 },
        ],
        state: [{ id: 'url', property: 'search', value: search }],
      }),
    });
    if (!response.ok) return '';
    const payload = await response.json() as { response?: { peak_table1?: MirrorTable } };
    captures?.push({scan,spectrumId,payload});
    return formatMirrorFragments(payload.response?.peak_table1 ?? {});
  } catch { return ''; } finally { clearTimeout(timer); }
}

async function structureDetails(item: Record<string, unknown>): Promise<{ image?: string; formula?: string }> {
  const smiles = String(item.Smiles ?? item.library_SMILES ?? '').trim();
  const inchi = String(item.INCHI ?? item.library_InChI ?? '').replace(/^"|"$/g, '').trim();
  const valid = (value: string) => value && !['null', 'nan', 'n/a'].includes(value.toLowerCase());
  const validInchi = valid(inchi); const validSmiles = valid(smiles);
  if (!validInchi && !validSmiles) return {};
  const query = validInchi ? `inchi=${encodeURIComponent(inchi)}` : `smiles=${encodeURIComponent(smiles)}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const [imageResponse, formulaResponse] = await Promise.all([
      fetch(`https://structure.gnps2.org/structureimg?${query}`, { signal: controller.signal }),
      fetch(`https://structure.gnps2.org/formula?${query}`, { signal: controller.signal }),
    ]);
    const type = imageResponse.headers.get('content-type')?.split(';')[0] ?? '';
    const image = imageResponse.ok && type.startsWith('image/')
      ? `data:${type};base64,${Buffer.from(await imageResponse.arrayBuffer()).toString('base64')}` : undefined;
    const formulaText = formulaResponse.ok ? (await formulaResponse.text()).trim() : '';
    const formula = /^[A-Z][A-Za-z0-9.+-]{0,100}$/.test(formulaText) ? formulaText : undefined;
    return { image, formula };
  } catch { return {}; } finally { clearTimeout(timer); }
}

export async function importGnpsTask(input: string, progress?: ProgressReporter) {
  const task = extractGnpsTaskId(input);
  emitProgress(progress, { stage: 'task', step: 1, percent: 3, title: 'Kiểm tra GNPS2 Task', message: 'Đang kiểm tra trạng thái và thông tin task.' });
  const statusHtml = await fetchText(`https://gnps2.org/status?task=${task}`, 'trạng thái task');
  const metadata = parseTaskStatus(statusHtml);
  if (metadata.status && metadata.status !== 'DONE') throw new ApiError(409, `Task GNPS2 chưa hoàn tất (trạng thái: ${metadata.status}).`, 'GNPS_TASK_NOT_DONE');
  emitProgress(progress, { stage: 'task', step: 1, percent: 8, title: metadata.title || 'GNPS2 Task đã hoàn tất', message: `Task ${task} đã sẵn sàng để nhập dữ liệu${metadata.workflow ? ` · ${metadata.workflow}` : ''}.` });
  emitProgress(progress, { stage: 'matches', step: 2, percent: 12, title: 'Đang lấy Library Matches', message: 'Đang tải danh sách kết quả khớp từ GNPS2.' });
  const libraryText = await fetchText(`https://gnps2.org/result?json=&task=${task}&viewname=librarymatches`, 'Library Matches');
  let library: Array<Record<string, unknown>>;
  try {
    library = JSON.parse(libraryText);
    if (!Array.isArray(library) || library.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Invalid rows');
  } catch {
    throw new ApiError(502, 'Library Matches GNPS2 không trả về danh sách JSON hợp lệ. Kiểm tra quyền truy cập và loại workflow của task.', 'GNPS_LIBRARY_INVALID');
  }
  emitProgress(progress, { stage: 'matches', step: 2, percent: 25, title: 'Đã lấy Library Matches', message: `Đã nhận ${library.length} dòng dữ liệu và các trường nguồn.`, current: library.length, total: library.length, succeeded: library.length });
  emitProgress(progress, { stage: 'network', step: 3, percent: 29, title: 'Đang lấy Network & RT', message: 'Đang tải Network GraphML để đối chiếu thời gian lưu và cấu trúc.' });
  const graphml = await fetchText(`https://gnps2.org/resultfile?task=${task}&file=${encodeURIComponent('nf_output/networking/network_singletons.graphml')}`, 'Network GraphML');
  let nodes: Map<string, RawRow>;
  try { nodes = parseNetworkGraphml(graphml); } catch {
    throw new ApiError(502, 'Network GraphML của task không hợp lệ hoặc workflow này chưa được hỗ trợ.', 'GNPS_GRAPH_INVALID');
  }
  emitProgress(progress, { stage: 'network', step: 3, percent: 37, title: 'Đã đọc Network & RT', message: `Đã đọc ${nodes.size} node để ghép với Library Matches.`, current: nodes.size, total: nodes.size, succeeded: nodes.size });
  emitProgress(progress, { stage: 'enrichment', step: 4, percent: 40, title: 'Đang bổ sung dữ liệu hợp chất', message: `Đang lấy ảnh cấu trúc, công thức và phổ mảnh vỡ cho ${library.length} hợp chất.`, current: 0, total: library.length });
  const captures:unknown[]=[];
  const sourceFiles:MediaInput[]=[
    {name:'library_matches.json',kind:'gnps_matches',mime:'application/json',bytes:Buffer.from(libraryText)},
    {name:'network_singletons.graphml',kind:'gnps_graphml',mime:'application/xml',bytes:Buffer.from(graphml)},
  ];
  const rows: MatchRow[] = [];
  let graphMatched = 0; let rtFallback = 0;
  let structureCount = 0; let fragmentCount = 0; let enrichedCount = 0;
  for (let index = 0; index < library.length; index += 5) {
    const batch = library.slice(index, index + 5);
    const enriched = await Promise.all(batch.map(async (item) => {
      const scan = String(item['#Scan#'] ?? '').trim();
      const [structure, fragments] = await Promise.all([
        structureDetails({ ...nodes.get(scan), ...item }), mirrorFragments(task, scan, item.SpectrumID,captures),
      ]);
      return { structure, fragments };
    }));
    enrichedCount += batch.length;
    structureCount += enriched.filter((item) => item.structure.image).length;
    fragmentCount += enriched.filter((item) => item.fragments).length;
    batch.forEach((item, offset) => {
      const sourceIndex = index + offset;
      const scan = String(item['#Scan#'] ?? '').trim();
      const node = nodes.get(scan);
      const graphRt = parseNumber(node?.rt_min);
      const fallbackRt = parseNumber(item.RT_Query);
      if (node && graphRt) graphMatched += 1; else if (fallbackRt) rtFallback += 1;
      const rt = graphRt || fallbackRt;
      const compound = splitCompound(item.Compound_Name ?? node?.library_compound_name);
      const mz = parseNumber(item.SpecMZ) || parseNumber(node?.mz) || parseNumber(item.LibMZ);
      rows.push({
        id: randomUUID(), selected: true, sourceTsvRow: sourceIndex + 1, sourceXlsxRow: node ? sourceIndex + 1 : 0,
        compoundName: compound.name, adduct: String(item.Adduct ?? '').trim() || compound.adduct,
        mzTsv: mz, mzData: parseNumber(node?.mz) || mz, rtTsv: fallbackRt, rtData: rt, rtDisplay: rt ? String(rt) : '',
        deltaDa: 0, deltaPpm: 0, deltaRt: graphRt && fallbackRt ? Math.abs(graphRt - fallbackRt) : 0,
        candidateCount: node ? 1 : 0, molecularFormula: String(item.molecular_formula ?? item.MolecularFormula ?? enriched[offset].structure.formula ?? ''),
        fragments: enriched[offset].fragments, reportedMzErrorPpm: item.MZErrorPPM == null ? null : parseNumber(item.MZErrorPPM),
        sourceMetadata: normalizeSourceMetadata(item),
        status: node && graphRt ? 'matched' : rt ? 'ambiguous' : 'unmatched', structureData: enriched[offset].structure.image,
      });
    });
    emitProgress(progress, {
      stage: 'enrichment', step: 4,
      percent: library.length ? Math.round(40 + 27 * enrichedCount / library.length) : 67,
      title: 'Đang bổ sung dữ liệu hợp chất',
      message: `Đã xử lý ${enrichedCount}/${library.length} hợp chất · ${structureCount} ảnh cấu trúc · ${fragmentCount} phổ mảnh vỡ.`,
      current: enrichedCount, total: library.length, succeeded: enrichedCount,
      detail: `${structureCount} ảnh cấu trúc · ${fragmentCount} phổ mảnh vỡ`,
    });
  }
  if (!library.length) emitProgress(progress, { stage: 'enrichment', step: 4, percent: 67, title: 'Không có dòng cần bổ sung', message: 'Library Matches không có hợp chất để lấy ảnh hoặc phổ mảnh vỡ.', current: 0, total: 0, succeeded: 0 });
  if(captures.length)sourceFiles.push({name:'spectrum_peaks.json',kind:'gnps_mgf',mime:'application/json',bytes:Buffer.from(JSON.stringify(captures))});
  return { task, metadata, rows, sourceFiles, libraryHeaders: Object.keys(library[0] ?? {}), graphMatched, rtFallback, graphNodes: nodes.size, structures: rows.filter((row) => row.structureData).length, fragments: rows.filter((row) => row.fragments).length };
}
