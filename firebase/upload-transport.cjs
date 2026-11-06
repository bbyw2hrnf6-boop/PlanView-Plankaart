// Firebase's streaming Hosting uploads stalled locally; a Buffer provides a fixed
// Content-Length. Preserve the exact gzip bytes, authentication and abort signal.
function bufferedHostingFetch(fetcher) {
  return async (input,options) => {
    const url=new URL(typeof input==='string'?input:input.url||String(input));
    const hostingUpload=url.protocol==='https:'&&url.hostname==='upload-firebasehosting.googleapis.com'&&/^\/upload\/sites\/planview-ecf9b\/versions\/[a-zA-Z0-9]+\/files\/[a-f0-9]{64}$/.test(url.pathname);
    if(hostingUpload&&options?.method==='POST'&&typeof options.body?.[Symbol.asyncIterator]==='function') {
      const chunks=[];
      for await(const chunk of options.body)chunks.push(Buffer.from(chunk));
      return fetcher(input,{...options,body:Buffer.concat(chunks)});
    }
    return fetcher(input,options);
  };
}
module.exports={bufferedHostingFetch};
