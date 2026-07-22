import { describe, expect, it } from 'vitest';
import { extractGnpsTaskId, formatMirrorFragments, parseMgfFragments, parseNetworkGraphml, parseTaskStatus } from './gnps-task.js';

const task = '2515573ac8c24ec8b85f553aad9b440e';

describe('GNPS2 task importer', () => {
  it('extracts a task ID from supported GNPS2 URLs and rejects other hosts', () => {
    expect(extractGnpsTaskId(`https://gnps2.org/status?task=${task}`)).toBe(task);
    expect(extractGnpsTaskId(`https://gnps2.org/result?viewname=librarymatches&task=${task}`)).toBe(task);
    expect(() => extractGnpsTaskId(`https://example.com/status?task=${task}`)).toThrow(/gnps2\.org/);
  });

  it('reads task metadata including a Vietnamese description', () => {
    const html = `<table><tr><td>Description</td><td><strong>Cao Xạ Đen 1 neg lần 2</strong></td></tr><tr><td>Workflow</td><td>classical_networking_workflow</td></tr><tr><td>Status</td><td>DONE</td></tr></table>`;
    expect(parseTaskStatus(html)).toEqual({ title: 'Cao Xạ Đen 1 neg lần 2', workflow: 'classical_networking_workflow', status: 'DONE' });
  });

  it('maps GraphML node 33 to rt_min and parses MGF fragments', () => {
    const xml = `<?xml version="1.0"?><graphml><key id="d2" for="node" attr.name="rt_min" attr.type="double"/><key id="d5" for="node" attr.name="library_compound_name" attr.type="string"/><graph edgedefault="undirected"><node id="33"><data key="d2">12.02</data><data key="d5">CAFFEIC ACID [M-H]-</data></node></graph></graphml>`;
    const nodes = parseNetworkGraphml(xml);
    expect(nodes.get('33')).toMatchObject({ rt_min: 12.02, library_compound_name: 'CAFFEIC ACID [M-H]-' });
    const fragments = parseMgfFragments('BEGIN IONS\nSCANS=33\n100.0 10\n135.0 100\n179.0 50\nEND IONS');
    expect(fragments.get('33')).toBe('100 (10), 135 (100), 179 (50)');
  });

  it('uses only checked peaks from the first mirror table and marks only 100 percent intensity', () => {
    const data = [
      { 'm/z': 135.0402, Intensity: 0.272 },
      { 'm/z': 135.04466247558594, Intensity: 1 },
      { 'm/z': 179.03326416015625, Intensity: 0.769 },
    ];
    expect(formatMirrorFragments({ data, selected_rows: [1] })).toBe('135 (100)');
    expect(formatMirrorFragments({ data, selected_rows: [0, 2] })).toBe('135, 179');
  });
});
