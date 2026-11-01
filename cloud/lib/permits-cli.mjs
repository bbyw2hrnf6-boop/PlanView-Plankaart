// Local server bridge. Exactly the same public data engine serves the cloud Worker.
import {fetchPermits,PermitError} from './permits.mjs';
try{
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>12000)throw new PermitError(413,'permit_request_too_large');}
  let payload;try{payload=JSON.parse(raw);}catch{throw new PermitError(400,'invalid_permit_input');}
  process.stdout.write(JSON.stringify(await fetchPermits(payload.input)));
}catch(error){process.stdout.write(JSON.stringify({error:error instanceof PermitError?error.code:'permit_sources_unavailable',status:error instanceof PermitError?error.status:502}));process.exitCode=1;}
