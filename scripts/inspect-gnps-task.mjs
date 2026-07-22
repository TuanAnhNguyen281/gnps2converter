const task = process.argv[2] ?? '2515573ac8c24ec8b85f553aad9b440e';
const statusHtml = await fetch(`https://gnps2.org/status?task=${task}`).then((response) => response.text());
for (const query of ['Cao', 'Description', 'description']) {
  const index = statusHtml.indexOf(query);
  console.log(query, index, index >= 0 ? statusHtml.slice(Math.max(0, index - 250), index + 500) : '');
}
const fileUrl = `https://gnps2.org/resultfile?task=${task}&file=${encodeURIComponent('nf_output/networking/network_singletons.graphml')}`;
const response = await fetch(fileUrl);
const graphml = await response.text();
console.log('file', response.status, response.headers.get('content-type'), response.headers.get('content-length'));
console.log(graphml.slice(0, 2500));
console.log('rt keys', [...graphml.matchAll(/<key[^>]+attr.name="([^"]*rt[^"]*)"[^>]*>/gi)].map((match) => match[1]));
for (const scan of ['33', '1']) {
  const node = graphml.match(new RegExp(`<node id="${scan}">[\\s\\S]*?<\\/node>`))?.[0];
  console.log(`node ${scan}`, node ?? 'not found');
}
