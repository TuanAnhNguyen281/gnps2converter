const usi1 = 'mzspec:GNPS2:TASK-2515573ac8c24ec8b85f553aad9b440e-nf_output/clustering/specs_ms.mgf:scan:33';
const usi2 = 'mzspec:GNPS:GNPS-LIBRARY:accession:CCMSLIB00005720803';
const url = `https://metabolomics-usi.gnps2.org/dashinterface/?usi1=${encodeURIComponent(usi1)}&usi2=${encodeURIComponent(usi2)}`;
const response = await fetch(url);
const html = await response.text();
console.log(response.status, html.length);
console.log([...html.matchAll(/<script[^>]+src="([^"]+)/g)].map((match) => match[1]));
console.log(html.slice(0, 5000));
for (const endpoint of ['_dash-layout', '_dash-dependencies']) {
  const resource = await fetch(`https://metabolomics-usi.gnps2.org/dashinterface/${endpoint}`).then((item) => item.text());
  console.log(`\n--- ${endpoint} (${resource.length}) ---\n`, resource.slice(0, 30000));
}
const output = '..peak_table1.columns...peak_table1.data...peak_table1.selected_rows...peak_table2.columns...peak_table2.data...peak_table2.selected_rows..';
const outputs = [
  ['peak_table1', 'columns'], ['peak_table1', 'data'], ['peak_table1', 'selected_rows'],
  ['peak_table2', 'columns'], ['peak_table2', 'data'], ['peak_table2', 'selected_rows'],
].map(([id, property]) => ({ id, property }));
const callback = await fetch('https://metabolomics-usi.gnps2.org/dashinterface/_dash-update-component', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    output, outputs, changedPropIds: ['usi1.value', 'usi2.value'],
    inputs: [
      { id: 'usi1', property: 'value', value: usi1 }, { id: 'usi2', property: 'value', value: usi2 },
      { id: 'mz_min', property: 'value', value: null }, { id: 'mz_max', property: 'value', value: null },
      { id: 'annotate_precision', property: 'value', value: 4 },
    ],
    state: [{ id: 'url', property: 'search', value: new URL(url).search }],
  }),
});
console.log('\n--- callback', callback.status, '---\n', await callback.text());
