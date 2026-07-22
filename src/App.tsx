import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnalysisResult, ColumnMapping, FilePreview, MatchRow, PreviewValue } from './types';

const MoleculeScene = lazy(() => import('./MoleculeScene'));

const icons = {
  flask: <svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9"/></svg>,
  upload: <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"/></svg>,
  file: <svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 13h6m-6 4h6"/></svg>,
  tune: <svg viewBox="0 0 24 24"><path d="M4 7h10m4 0h2M14 4v6M4 17h2m4 0h10M10 14v6"/></svg>,
  check: <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>,
  sun: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>,
  moon: <svg viewBox="0 0 24 24"><path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z"/></svg>,
  close: <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>,
};

type Stage = 'upload' | 'results';
type PreviewKind = 'tsv' | 'xlsx';
type PreviewStatus = { data: FilePreview | null; loading: boolean; error: string };
const mappingLabels: Record<keyof ColumnMapping, string> = {
  compoundName: 'Tên hoạt chất (TSV) *', adduct: 'Ion/Adduct (TSV)', precursorMz: 'Precursor m/z (TSV) *',
  formula: 'Công thức phân tử (TSV)', reportedPpm: 'Sai số MZErrorPPM (TSV)', fragments: 'Mảnh vỡ (TSV)',
  excelCompoundName: 'Tên đối chiếu (Excel) *', excelRt: 'tR (min) từ Excel *',
};

function FileDrop({ accept, label, hint, file, onFile }: { accept: string; label: string; hint: string; file: File | null; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return <button type="button" className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
    onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
    onDrop={(e) => { e.preventDefault(); setDrag(false); const next = e.dataTransfer.files[0]; if (next) onFile(next); }}>
    <input ref={input} type="file" accept={accept} hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    <span className="drop-icon">{file ? icons.check : icons.upload}</span>
    <span className="drop-copy"><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB · Sẵn sàng` : hint}</small></span>
    <span className="file-pill">{accept.replaceAll('.', '').toUpperCase()}</span>
  </button>;
}

function titleFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function Highlight({ value, query }: { value: PreviewValue; query: string }) {
  const text = value == null ? '' : String(value);
  const needle = query.trim().toLocaleLowerCase('vi');
  if (!needle) return <>{text || '—'}</>;
  const parts: React.ReactNode[] = []; let cursor = 0; const lower = text.toLocaleLowerCase('vi');
  while (cursor < text.length) {
    const found = lower.indexOf(needle, cursor);
    if (found < 0) { parts.push(text.slice(cursor)); break; }
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(<mark key={`${found}-${cursor}`}>{text.slice(found, found + needle.length)}</mark>);
    cursor = found + needle.length;
  }
  return <>{parts.length ? parts : text || '—'}</>;
}

function FileViewer({ files, previews, onSheet, initialActive='tsv', onClose }: {
  files: Record<PreviewKind, File | null>; previews: Record<PreviewKind, PreviewStatus>;
  onSheet: (sheet: string) => void; initialActive?:PreviewKind; onClose?:()=>void;
}) {
  const [active, setActive] = useState<PreviewKind>(initialActive); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const current = previews[active]; const file = files[active]; const pageSize = 50;
  useEffect(() => { if (!files[active] && files[active === 'tsv' ? 'xlsx' : 'tsv']) setActive(active === 'tsv' ? 'xlsx' : 'tsv'); }, [files.tsv, files.xlsx]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi'); const rows = current.data?.rows ?? [];
    return needle ? rows.filter(row => row.some(value => String(value ?? '').toLocaleLowerCase('vi').includes(needle))) : rows;
  }, [current.data, search]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  useEffect(() => setPage(1), [active, search, current.data?.activeSheet]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const shown = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  return <section className="file-viewer" aria-label="Trình xem nội dung file">
    <header className="viewer-head"><div><small>TRÌNH XEM FILE</small><strong>{file?.name ?? 'Chưa chọn file'}</strong>{file&&<span>{(file.size/1024).toLocaleString('vi-VN',{maximumFractionDigits:1})} KB</span>}</div><div className="viewer-head-actions"><div className="viewer-tabs"><button title={files.tsv?.name} className={active==='tsv'?'active':''} disabled={!files.tsv} onClick={()=>setActive('tsv')}>{files.tsv?.name??'TSV'}</button><button title={files.xlsx?.name} className={active==='xlsx'?'active':''} disabled={!files.xlsx} onClick={()=>setActive('xlsx')}>{files.xlsx?.name??'XLSX'}</button></div>{onClose&&<button className="viewer-close" onClick={onClose} aria-label="Đóng trình xem">{icons.close}</button>}</div></header>
    <div className="viewer-toolbar"><label className="viewer-search">{icons.search}<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Tìm trong toàn bộ nội dung…"/>{search&&<button onClick={()=>setSearch('')} aria-label="Xóa tìm kiếm">×</button>}</label>{active==='xlsx'&&current.data?.sheets.length?<select value={current.data.activeSheet} onChange={event=>onSheet(event.target.value)}>{current.data.sheets.map(sheet=><option key={sheet}>{sheet}</option>)}</select>:null}</div>
    <div className="viewer-body">{current.loading?<div className="viewer-state"><span className="spinner"/><strong>Đang đọc nội dung file…</strong></div>:current.error?<div className="viewer-state error"><strong>Không thể xem file</strong><span>{current.error}</span></div>:!file?<div className="viewer-state">{icons.file}<strong>Chọn file {active.toUpperCase()} để xem nội dung</strong><span>Dữ liệu sẽ xuất hiện tại đây trước khi đối chiếu.</span></div>:current.data?<div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>#</th>{current.data.columns.map((column,index)=><th key={`${column}-${index}`} title={column}>{column}</th>)}</tr></thead><tbody>{shown.map((row,rowIndex)=><tr key={(page-1)*pageSize+rowIndex}><td>{(page-1)*pageSize+rowIndex+1}</td>{current.data!.columns.map((_,cellIndex)=><td key={cellIndex} title={String(row[cellIndex]??'')}><Highlight value={row[cellIndex]??null} query={search}/></td>)}</tr>)}</tbody></table>{!shown.length&&<div className="viewer-empty">Không tìm thấy nội dung phù hợp.</div>}</div>:null}</div>
    {current.data&&<footer className="viewer-footer"><div><b>{filteredRows.length.toLocaleString('vi-VN')}</b>/{current.data.totalRows.toLocaleString('vi-VN')} dòng · {current.data.columns.length} cột{current.data.previewLimited&&<span> · Chỉ xem trước 1.000 dòng</span>}</div><div className="viewer-pagination"><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>←</button><span>{page}/{pages}</span><button disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>→</button></div></footer>}
  </section>;
}

async function download(url: string, rows: MatchRow[], extension: string, title: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, title, fileName: title }) });
  if (!response.ok) throw new Error((await response.json()).message ?? 'Không thể xuất file.');
  const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'GNPS2_Report';
  const link = document.createElement('a'); link.href = objectUrl; link.download = `${safeTitle}.${extension}`; link.click();
  URL.revokeObjectURL(objectUrl);
}

export default function App() {
  const [theme, setTheme] = useState<'dark'|'light'>(() => {
    const saved = localStorage.getItem('gnps2-theme');
    return saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [inputMode, setInputMode] = useState<'task'|'files'>('task');
  const taskPanelRef = useRef<HTMLDivElement>(null); const filesPanelRef = useRef<HTMLDivElement>(null);
  const [panelHeights, setPanelHeights] = useState({task: 0, files: 0});
  const [taskUrl, setTaskUrl] = useState('');
  const [tsv, setTsv] = useState<File | null>(null); const [xlsx, setXlsx] = useState<File | null>(null);
  const [previews, setPreviews] = useState<Record<PreviewKind, PreviewStatus>>({tsv:{data:null,loading:false,error:''},xlsx:{data:null,loading:false,error:''}});
  const previewRequests = useRef<Record<PreviewKind, number>>({tsv:0,xlsx:0});
  const [reportTitle, setReportTitle] = useState('');
  const [gnpsUrl, setGnpsUrl] = useState('');
  const [stage, setStage] = useState<Stage>('upload'); const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all'|'matched'|'ambiguous'|'unmatched'|'selected'>('all'); const [mappingOpen, setMappingOpen] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null); const [headers, setHeaders] = useState<{tsv:string[];excel:string[]}>({tsv:[],excel:[]});
  const [exporting, setExporting] = useState(''); const [structureLoading, setStructureLoading] = useState(false); const [structureMessage, setStructureMessage] = useState('');
  const [loadingMode, setLoadingMode] = useState<'task'|'files'|null>(null);
  const [detailRow, setDetailRow] = useState<MatchRow | null>(null);
  const [viewerTarget, setViewerTarget] = useState<PreviewKind | null>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('gnps2-theme', theme); }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle('upload-snap', stage === 'upload');
    return () => document.documentElement.classList.remove('upload-snap');
  }, [stage]);
  useEffect(() => {
    const measure = () => setPanelHeights({ task: taskPanelRef.current?.scrollHeight ?? 0, files: filesPanelRef.current?.scrollHeight ?? 0 });
    measure();
    const observer = new ResizeObserver(measure);
    if (taskPanelRef.current) observer.observe(taskPanelRef.current);
    if (filesPanelRef.current) observer.observe(filesPanelRef.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  function switchInputMode(next: 'task'|'files') {
    if (next === inputMode) return;
    setInputMode(next);
  }
  async function loadPreview(file: File, kind: PreviewKind, sheetName = '') {
    const requestId = ++previewRequests.current[kind];
    setPreviews(current=>({...current,[kind]:{...current[kind],loading:true,error:''}}));
    const body = new FormData(); body.append('file',file); if(sheetName) body.append('sheetName',sheetName);
    try { const response=await fetch('/api/files/preview',{method:'POST',body}); const payload=await response.json() as FilePreview&{message?:string}; if(!response.ok) throw new Error(payload.message??'Không thể đọc file.'); if(previewRequests.current[kind]!==requestId)return; setPreviews(current=>({...current,[kind]:{data:payload,loading:false,error:''}})); }
    catch(caught){if(previewRequests.current[kind]!==requestId)return;setPreviews(current=>({...current,[kind]:{...current[kind],loading:false,error:caught instanceof Error?caught.message:'Không thể đọc file.'}}));}
  }
  function selectTsv(file:File){setTsv(file);setReportTitle(titleFromFile(file.name));void loadPreview(file,'tsv');}
  function selectXlsx(file:File){setXlsx(file);void loadPreview(file,'xlsx');}

  async function analyze(forcedMapping?: ColumnMapping) {
    if (!tsv || !xlsx) { setError('Hãy chọn đủ hai file TSV và XLSX.'); return; }
    setLoading(true); setLoadingMode('files'); setError('');
    const data = new FormData(); data.append('tsv', tsv); data.append('xlsx', xlsx);
    if (forcedMapping) data.append('mapping', JSON.stringify(forcedMapping));
    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: data }); const payload = await response.json();
      if (!response.ok) {
        if (payload.code === 'COLUMN_MAPPING_REQUIRED') { setHeaders({ tsv: payload.tsvHeaders, excel: payload.excelHeaders }); setMapping(payload.mapping); setMappingOpen(true); return; }
        throw new Error(payload.message ?? 'Phân tích thất bại.');
      }
      setResult(payload); setStage('results'); setMappingOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể kết nối máy chủ.'); }
    finally { setLoading(false); setLoadingMode(null); }
  }

  async function importTask() {
    if (!taskUrl.trim()) { setError('Hãy nhập link GNPS2 Task.'); return; }
    setLoading(true); setLoadingMode('task'); setError(''); setStructureMessage('');
    try {
      const response = await fetch('/api/gnps-task/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:taskUrl.trim()}) });
      const payload = await response.json() as AnalysisResult & { message?: string; title?: string };
      if (!response.ok) throw new Error(payload.message ?? 'Không thể đọc task GNPS2.');
      setResult(payload); setReportTitle(payload.title || 'GNPS2 Report'); setGnpsUrl(taskUrl.trim()); setStage('results');
      setStructureMessage(`Đã tự động lấy ${payload.summary.structures ?? 0}/${payload.rows.length} ảnh cấu trúc và ${payload.summary.fragments ?? 0} phổ mảnh vỡ từ GNPS2.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể kết nối GNPS2.'); }
    finally { setLoading(false); setLoadingMode(null); }
  }

  const filtered = useMemo(() => (result?.rows ?? []).filter((row) => {
    const text = `${row.compoundName} ${row.adduct} ${row.molecularFormula}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (status === 'all' || (status === 'selected' ? row.selected : row.status === status));
  }), [result, query, status]);
  const selectedCount = result?.rows.filter((row) => row.selected).length ?? 0;
  function update(id: string, patch: Partial<MatchRow>) { setResult((current) => current ? { ...current, rows: current.rows.map((row) => row.id === id ? { ...row, ...patch } : row) } : current); }
  function updateDetail(patch: Partial<MatchRow>) { if (!detailRow) return; update(detailRow.id, patch); setDetailRow({...detailRow,...patch}); }
  async function doExport(type: 'docx'|'xlsx') { if (!result) return; setExporting(type); setError(''); try { await download(`/api/export/${type}`, result.rows, type, reportTitle); } catch (e) { setError(e instanceof Error ? e.message : 'Xuất file thất bại.'); } finally { setExporting(''); } }
  async function resolveStructures() {
    if (!result || !gnpsUrl.trim()) return; const targets = result.rows.filter(row => row.selected);
    if (!targets.length) return; setStructureLoading(true); setError(''); setStructureMessage('');
    try { const response = await fetch('/api/structures/gnps2', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:gnpsUrl.trim(),rows:targets.map(({id,compoundName})=>({id,compoundName}))}) }); const payload = await response.json() as {message?:string;resolved:Array<{id:string;structureData?:string}>;found:number;libraryMatches:number}; if(!response.ok) throw new Error(payload.message); const map = new Map<string,string|undefined>(payload.resolved.map(item=>[item.id,item.structureData])); setResult({...result,rows:result.rows.map(row=>targets.some(target=>target.id===row.id)?{...row,structureData:map.get(row.id)}:row)}); setStructureMessage(`Đã lấy ${payload.found}/${targets.length} ảnh từ ${payload.libraryMatches} Library Matches. Dòng không có ảnh được để trống.`); }
    catch(e){setError(e instanceof Error?e.message:'Không thể tra cứu PubChem.');} finally{setStructureLoading(false);}
  }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#" onClick={() => setStage('upload')}><span>{icons.flask}</span><div><strong>GNPS<span>2</span></strong><small>CONVERTER</small></div></a>
      <nav className="steps" aria-label="Tiến trình"><span className="active"><i>1</i> Dữ liệu</span><b/><span className={stage === 'results' ? 'active' : ''}><i>2</i> Đối sánh</span><b/><span className={stage === 'results' ? 'active' : ''}><i>3</i> Xuất báo cáo</span></nav>
      <div className="top-actions"><div className="system-status"><i/> Engine sẵn sàng</div><button className="theme-toggle" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={theme==='dark'?'Bật giao diện sáng':'Bật giao diện tối'} title={theme==='dark'?'Chế độ sáng':'Chế độ tối'}>{theme==='dark'?icons.sun:icons.moon}</button></div></header>

    <main>
      <AnimatePresence mode="wait">
      {stage === 'upload' ? <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -15 }}>
        <section className="hero"><Suspense fallback={<div className="scene-fallback"/>}><MoleculeScene/></Suspense><div className="hero-glow"/><div className="hero-copy">
          <div className="eyebrow"><span>•</span> KHÔNG GIAN PHÂN TÍCH PHỔ KHỐI</div>
          <h1>Biến dữ liệu phổ khối<br/>thành <em>báo cáo chuẩn xác.</em></h1>
          <p>Đối sánh GNPS với dữ liệu thực nghiệm, kiểm duyệt trực quan và xuất báo cáo Word chỉ trong một quy trình.</p>
          <div className="trust"><span>{icons.check} Kiểm soát sai số</span><span>{icons.check} Chỉnh sửa thủ công</span><span>{icons.check} Dữ liệu xử lý cục bộ</span></div>
        </div></section>
        <section className="workspace">
          <div className="section-heading"><div><span className="index">01</span><div><h2>Nạp dữ liệu phân tích</h2><p>Dán link GNPS2 Task hoặc dùng hai file dữ liệu trên máy.</p></div></div><span className="secure">● SECURE SESSION</span></div>
          <div className="source-tabs"><motion.span className="tab-highlight" animate={{x:inputMode==='task'?'0%':'100%'}} transition={{type:'spring',stiffness:420,damping:34}}/><button className={inputMode==='task'?'active':''} onClick={()=>switchInputMode('task')}><b>Nhập link GNPS2</b></button><button className={inputMode==='files'?'active':''} onClick={()=>switchInputMode('files')}><b>Tải TSV + XLSX</b></button></div>
          <motion.div className="source-panels" animate={{height:panelHeights[inputMode]||'auto'}} transition={{duration:.36,ease:[.22,1,.36,1]}}>
          <motion.div className="source-track" animate={{x:inputMode==='task'?'0%':'-50%'}} transition={{duration:.48,ease:[.22,1,.36,1]}}>
          <div ref={taskPanelRef} className="task-import-card source-panel">
            <div className="task-import-copy"><span>{icons.search}</span><div><strong>GNPS2 Task tự động</strong><small>Đọc tiêu đề, Library Matches, Network RT, fragments và cấu trúc phân tử.</small></div></div>
            <label><span>LINK STATUS / RESULT / NETWORK</span><input type="url" value={taskUrl} onChange={(e)=>setTaskUrl(e.target.value)} placeholder="https://gnps2.org/status?task=..."/></label>
            <button className="primary" disabled={loading||!taskUrl.trim()} onClick={importTask}>{loading?<span className="spinner"/>:icons.flask}{loading?'Đang đọc GNPS2…':'Đọc dữ liệu GNPS2'}<small>→</small></button>
            <div className="task-stages"><span>1. Task & tiêu đề</span><i/> <span>2. Library Matches</span><i/> <span>3. Network & RT</span><i/> <span>4. Ảnh cấu trúc</span></div>
          </div><div ref={filesPanelRef} className="source-panel files-panel"><div className="file-import-controls">
            <div className="upload-grid"><FileDrop accept=".tsv" label="Kết quả định danh GNPS" hint="Kéo thả hoặc nhấn để chọn file TSV" file={tsv} onFile={selectTsv}/><div className="connector"><span>+</span></div><FileDrop accept=".xlsx" label="Dữ liệu thực nghiệm" hint="Kéo thả hoặc nhấn để chọn Data.xlsx" file={xlsx} onFile={selectXlsx}/></div>
            <label className="title-field"><span><b>TIÊU ĐỀ BÁO CÁO</b><small>Tự nhận diện từ tên file TSV — bạn có thể sửa lại</small></span><input value={reportTitle} onChange={(e)=>setReportTitle(e.target.value)} placeholder="Chọn file TSV để tự nhận diện tiêu đề" maxLength={160}/><i>{reportTitle.length}/160</i></label>
            <div className="settings-card compact-action"><div className="settings-title"><span>{icons.tune}</span><div><strong>Đối chiếu theo tên hợp chất</strong><small>Compound_Name (TSV) ↔ library_compound_name (Excel), lấy tR từ rt_min</small></div></div><button className="primary" disabled={loading || !tsv || !xlsx || !reportTitle.trim()} onClick={() => analyze()}>{loading ? <span className="spinner"/> : icons.flask}{loading ? 'Đang đối chiếu…' : 'Bắt đầu đối chiếu'}<small>→</small></button></div>
            </div>
          </div></motion.div></motion.div>{error && <div className="alert">{error}</div>}
        </section>
      </motion.div> : result && <motion.section key="results" className="results-page" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="results-head"><div><button className="back" onClick={() => setStage('upload')}>← Dữ liệu đầu vào</button><label className="result-title-label">TIÊU ĐỀ BÁO CÁO<input value={reportTitle} onChange={(e)=>setReportTitle(e.target.value)} maxLength={160}/></label><p>Kiểm tra, hiệu chỉnh và chọn các hợp chất trước khi xuất báo cáo.</p></div><div className="export-actions">{result.source!=='gnps-task'&&<><button className={viewerTarget==='tsv'?'viewer-action active':''} disabled={!tsv} onClick={()=>setViewerTarget(viewerTarget==='tsv'?null:'tsv')}>{icons.file} Xem TSV</button><button className={viewerTarget==='xlsx'?'viewer-action active':''} disabled={!xlsx} onClick={()=>setViewerTarget(viewerTarget==='xlsx'?null:'xlsx')}>{icons.file} Xem XLSX</button><button onClick={()=>{setHeaders({tsv:result.tsvHeaders,excel:result.excelHeaders});setMapping(result.mapping);setMappingOpen(true)}}>{icons.tune} Ánh xạ lại</button></>}<button onClick={() => doExport('xlsx')} disabled={!!exporting}>{icons.download} {exporting === 'xlsx' ? 'Đang tạo…' : 'Xuất Excel'}</button><button className="primary" onClick={() => doExport('docx')} disabled={!!exporting || !reportTitle.trim()}>{icons.download} {exporting === 'docx' ? 'Đang tạo…' : 'Xuất Word'}</button></div></div>
        <div className="gnps-card"><div><strong>Ảnh cấu trúc từ GNPS2</strong><small>Dán URL trang Library Matches. Không tìm thấy cấu trúc sẽ để trống.</small></div><input type="url" value={gnpsUrl} onChange={(e)=>setGnpsUrl(e.target.value)} placeholder="https://gnps2.org/result?task=...&viewname=librarymatches"/><button onClick={resolveStructures} disabled={structureLoading||!gnpsUrl.trim()}>{structureLoading?<span className="spinner"/>:icons.flask}{structureLoading?'Đang lấy ảnh…':'Lấy ảnh GNPS2'}</button></div>
        {structureMessage&&<motion.div className="notice" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}}><span>{icons.check}</span><p>{structureMessage}</p><button onClick={()=>setStructureMessage('')} aria-label="Đóng thông báo">{icons.close}</button></motion.div>}{error&&<div className="alert">{error}</div>}
        <div className="stats"><article><small>DÒNG TSV</small><strong>{result.summary.tsvRows}</strong><span>Dữ liệu nguồn</span></article><article><small>ĐÃ ĐỐI CHIẾU</small><strong>{result.summary.matched}</strong><span className="green">✓ Tìm thấy tên</span></article><article><small>CHƯA KHỚP</small><strong>{result.summary.unmatched}</strong><span>Không tìm thấy tên Excel</span></article><article><small>CẦN DUYỆT</small><strong>{result.rows.filter(r=>r.status==='ambiguous').length}</strong><span className="amber">Nhiều tên tương ứng</span></article><article><small>ĐÃ CHỌN</small><strong>{selectedCount}</strong><span>Sẽ đưa vào báo cáo</span></article></div>
        <div className={`results-workbench ${viewerTarget?'viewer-open':''}`}><div className="data-card"><div className="table-tools"><div className="search">{icons.search}<input placeholder="Tìm hoạt chất, ion, công thức…" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><div className="filters">{(['all','matched','ambiguous','unmatched','selected'] as const).map(value=><button className={status===value?'active':''} onClick={()=>setStatus(value)} key={value}>{{all:'Tất cả',matched:'Khớp',ambiguous:'Cần duyệt',unmatched:'Chưa có RT',selected:'Đã chọn'}[value]}</button>)}</div><span className="result-count">{filtered.length} kết quả</span></div>
          <div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={selectedCount===result.rows.length && !!selectedCount} onChange={(e)=>setResult({...result,rows:result.rows.map(r=>({...r,selected:e.target.checked}))})}/></th><th>STT</th><th>tR (min)</th><th>Tên hoạt chất dự đoán</th><th>Ion</th><th>Ion tiền chất (m/z)</th><th>Mảnh vỡ (m/z)</th><th>Công thức phân tử (sai số ppm)</th><th>Cấu trúc phân tử</th></tr></thead><tbody>
            {filtered.map((row,index)=><tr key={row.id} className={!row.selected?'muted':''}><td><input type="checkbox" checked={row.selected} onChange={(e)=>update(row.id,{selected:e.target.checked})}/></td><td className="mono faint">{index+1}</td><td className="rt-cell"><input className="cell-input mono" value={row.rtDisplay} onChange={(e)=>update(row.id,{rtDisplay:e.target.value})}/></td><td className="wrapping-cell compound-cell"><textarea className="cell-input wrapping-input compound" rows={1} value={row.compoundName} onChange={(e)=>update(row.id,{compoundName:e.target.value})}/></td><td><input className="cell-input mono" value={row.adduct} onChange={(e)=>update(row.id,{adduct:e.target.value})}/></td><td><input className="cell-input mono" type="number" step="any" value={row.mzTsv} onChange={(e)=>update(row.id,{mzTsv:Number(e.target.value)})}/></td><td className="wrapping-cell fragments-cell"><textarea className="cell-input wrapping-input" rows={1} value={row.fragments} placeholder="—" onChange={(e)=>update(row.id,{fragments:e.target.value})}/></td><td className="formula-cell"><input className="cell-input mono formula-value" value={row.molecularFormula} onChange={(e)=>update(row.id,{molecularFormula:e.target.value})}/><label className="ppm-editor"><input className="cell-input mono" type="number" step="any" value={row.reportedMzErrorPpm ?? ''} placeholder="—" onChange={(e)=>update(row.id,{reportedMzErrorPpm:e.target.value===''?null:Number(e.target.value)})}/><span>ppm</span></label></td><td className="structure-cell">{row.structureData?<button className="structure-preview" type="button" onClick={()=>setDetailRow(row)} aria-label={`Xem chi tiết ${row.compoundName}`}><img src={row.structureData} alt={`Cấu trúc ${row.compoundName}`}/><small>Xem chi tiết</small></button>:<span>Chưa tra cứu</span>}</td></tr>)}
          </tbody></table>{!filtered.length&&<div className="empty">Không có kết quả phù hợp bộ lọc.</div>}</div>
          <div className="table-footer"><span><b>{selectedCount}</b>/{result.rows.length} dòng được chọn</span><span>{result.source==='gnps-task'?'GNPS2 Library #Scan# · tR lấy từ ': 'Đối chiếu tên hợp chất · tR lấy từ '}<b>{result.source==='gnps-task'?'Network GraphML.rt_min':'Excel.rt_min'}</b></span></div>
        </div>{viewerTarget&&<motion.aside className="result-file-viewer" initial={{opacity:0,x:28}} animate={{opacity:1,x:0}} exit={{opacity:0,x:20}}><FileViewer key={viewerTarget} initialActive={viewerTarget} files={{tsv,xlsx}} previews={previews} onSheet={(sheet)=>xlsx&&void loadPreview(xlsx,'xlsx',sheet)} onClose={()=>setViewerTarget(null)}/></motion.aside>}</div>
      </motion.section>}
      </AnimatePresence>
    </main>

    <AnimatePresence>{mappingOpen && mapping && <motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.div className="modal" initial={{scale:.96,y:20}} animate={{scale:1,y:0}}>
      <div className="modal-head"><span>{icons.tune}</span><div><h2>Ánh xạ cột dữ liệu</h2><p>Chọn cột tương ứng. Các trường có dấu * là bắt buộc.</p></div></div>
      <div className="mapping-grid">{(Object.keys(mappingLabels) as (keyof ColumnMapping)[]).map(key=>{const isExcel=key==='excelCompoundName'||key==='excelRt'; return <label key={key}><span>{mappingLabels[key]}</span><select value={mapping[key]} onChange={(e)=>setMapping({...mapping,[key]:e.target.value})}><option value="">— Không sử dụng —</option>{(isExcel?headers.excel:headers.tsv).map(header=><option key={header}>{header}</option>)}</select></label>})}</div>
      <div className="modal-actions"><button onClick={()=>setMappingOpen(false)}>Hủy</button><button className="primary" disabled={!mapping.compoundName||!mapping.precursorMz||!mapping.excelCompoundName||!mapping.excelRt||loading} onClick={()=>analyze(mapping)}>{loading?'Đang xử lý…':'Áp dụng & đối chiếu'}</button></div>
    </motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{detailRow&&<motion.div className="modal-backdrop compound-dialog-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={()=>setDetailRow(null)}><motion.div className="compound-dialog" role="dialog" aria-modal="true" aria-labelledby="compound-dialog-title" initial={{opacity:0,scale:.95,y:22}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.97,y:12}} transition={{duration:.24,ease:[.22,1,.36,1]}} onMouseDown={(event)=>event.stopPropagation()}><button className="dialog-close" type="button" onClick={()=>setDetailRow(null)} aria-label="Đóng">{icons.close}</button><div className="compound-dialog-image">{detailRow.structureData?<img src={detailRow.structureData} alt={`Cấu trúc ${detailRow.compoundName}`}/>:<span>Không có ảnh cấu trúc</span>}</div><div className="compound-dialog-content"><small>THÔNG TIN HỢP CHẤT · CÓ THỂ CHỈNH SỬA</small><label className="dialog-name"><span>Tên hoạt chất</span><textarea id="compound-dialog-title" rows={2} value={detailRow.compoundName} onChange={(e)=>updateDetail({compoundName:e.target.value})}/></label><div className="dialog-fields"><label><span>tR (min)</span><input value={detailRow.rtDisplay} onChange={(e)=>updateDetail({rtDisplay:e.target.value})}/></label><label><span>Ion/Adduct</span><input value={detailRow.adduct} onChange={(e)=>updateDetail({adduct:e.target.value})}/></label><label><span>Ion tiền chất (m/z)</span><input type="number" step="any" value={detailRow.mzTsv} onChange={(e)=>updateDetail({mzTsv:Number(e.target.value)})}/></label><label><span>Công thức phân tử</span><input value={detailRow.molecularFormula} onChange={(e)=>updateDetail({molecularFormula:e.target.value})}/></label><label><span>Sai số ppm</span><input type="number" step="any" value={detailRow.reportedMzErrorPpm??''} placeholder="—" onChange={(e)=>updateDetail({reportedMzErrorPpm:e.target.value===''?null:Number(e.target.value)})}/></label><label className="dialog-fragments"><span>Mảnh vỡ (m/z)</span><textarea rows={4} value={detailRow.fragments} onChange={(e)=>updateDetail({fragments:e.target.value})}/></label></div><div className="dialog-save-note">{icons.check}<span>Thay đổi được lưu tự động vào bảng kết quả</span></div></div></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{loadingMode&&<motion.div className="loading-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.div className="loading-panel" initial={{scale:.96,y:18}} animate={{scale:1,y:0}} exit={{scale:.98,y:-10}}><div className="loading-orbit"><i/><i/><i/><span>{icons.flask}</span></div><div className="loading-copy"><small>GNPS2 DATA PIPELINE</small><h2>{loadingMode==='task'?'Đang đồng bộ dữ liệu GNPS2':'Đang đối chiếu dữ liệu'}</h2><p>Vui lòng giữ cửa sổ này mở. Hệ thống sẽ tự chuyển sang danh sách khi hoàn tất.</p></div><div className="loading-stages"><span>Task & tiêu đề</span><i/><span>Library Matches</span><i/><span>Network & RT</span><i/><span>Cấu trúc</span></div><div className="loading-bar"><b/></div></motion.div></motion.div>}</AnimatePresence>
    <footer><span>GNPS2 CONVERTER · Analytical workspace</span><span>createby TuanAnhNguyen</span></footer>
  </div>;
}
