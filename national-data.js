// Public data files are compressed per tile to keep nationwide mobile downloads small.
async function fetchDataJSON(url){
  const response=await fetch(url);if(!response.ok)throw new Error(`Data unavailable (${response.status})`);
  if(!url.split('?')[0].endsWith('.gz'))return response.json();
  const bytes=new Uint8Array(await response.arrayBuffer());
  // Some hosts apply content-encoding themselves; avoid decoding an expanded body twice.
  if(bytes[0]!==31||bytes[1]!==139)return JSON.parse(new TextDecoder().decode(bytes));
  if(typeof DecompressionStream==='undefined')throw new Error('Please update your browser to load nationwide map data.');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}
