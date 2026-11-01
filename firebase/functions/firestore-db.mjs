import {createHash} from 'node:crypto';
// Small adapter for the existing engine's fixed D1 statements. No user SQL is accepted.
// Firestore transactions preserve cross-instance rate limits and lease ownership.
export function firestoreDB(db) {
  const ref=(table,user,provider='')=>db.collection('planview_private').doc(createHash('sha256').update(JSON.stringify([table,user,provider])).digest('hex'));
  return {prepare(statement) {
    const sql=statement.replace(/\s+/g,' ').trim();
    return {bind(...args) {return {
      async first() {
        const m=/^SELECT (?:ciphertext, iv|updated_at) FROM (ai_credentials|source_credentials) WHERE user_id = \?(?: AND provider = \?)?$/.exec(sql);
        if(!m)throw Error('unsupported_storage_statement');
        const result=await ref(m[1],args[0],args[1]).get();return result.exists?result.data():null;
      },
      async run() {
        if(sql.startsWith('DELETE FROM ai_credentials WHERE user_id = ?')||sql.startsWith('DELETE FROM source_credentials WHERE user_id = ?')) {
          await ref(sql.includes('source_credentials')?'source_credentials':'ai_credentials',args[0],args[1]).delete();return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT INTO ai_credentials ')||sql.startsWith('INSERT INTO source_credentials ')) {
          const source=sql.startsWith('INSERT INTO source_credentials '),[user,...rest]=args;
          const [provider,ciphertext,iv,updated_at]=source?rest:['',...rest];
          await ref(source?'source_credentials':'ai_credentials',user,provider).set({ciphertext,iv,updated_at});return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT INTO ai_usage ')) {
          const [user,now,lease]=args,publicRouting=sql.includes('VALUES (?, ?, 0, ?)');
          const limit=args[9],windowEnd=now-300000,document=ref('ai_usage',user);
          return db.runTransaction(async tx=>{
            const snapshot=await tx.get(document),old=snapshot.exists?snapshot.data():null;
            const blocked=old&&(publicRouting?old.busy_until>now:old.busy_until>=now||(old.window_start>=windowEnd&&old.requests>=limit));
            if(blocked)return {meta:{changes:0}};
            tx.set(document,{window_start:!old||publicRouting||old.window_start<windowEnd?now:old.window_start,requests:publicRouting?0:!old||old.window_start<windowEnd?1:old.requests+1,busy_until:lease});
            return {meta:{changes:1}};
          });
        }
        if(sql==='UPDATE ai_usage SET busy_until = 0 WHERE user_id = ? AND busy_until = ?'||sql==='UPDATE ai_usage SET busy_until = ? WHERE user_id = ? AND busy_until = ?') {
          const [until,user,lease]=args.length===2?[0,...args]:args,document=ref('ai_usage',user);
          return db.runTransaction(async tx=>{const snapshot=await tx.get(document);if(!snapshot.exists||snapshot.data().busy_until!==lease)return {meta:{changes:0}};tx.update(document,{busy_until:until});return {meta:{changes:1}};});
        }
        throw Error('unsupported_storage_statement');
      }
    };}};
  }};
}
