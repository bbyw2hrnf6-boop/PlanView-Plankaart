// Local-only bridge: no credentials, URLs or source text are accepted for retrieval.
import {PermitError} from './permits.mjs';
import {cleanPermitQuestionInput,retrievePermitQuestionSources,permitAnswerSchema,permitQuestionInstructions,validatePermitAnswer,permitIntentSchema,permitIntentInstructions,validatePermitIntent} from './permit-answer.mjs';
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>250000)throw new PermitError(413,'permit_question_too_large');}
 let payload;try{payload=JSON.parse(raw);}catch{throw new PermitError(400,'invalid_permit_question');}
 if(payload.mode==='validate')process.stdout.write(JSON.stringify(validatePermitAnswer(payload.answer,payload.sources)));
 else if(payload.mode==='intent-config'){const input=cleanPermitQuestionInput(payload.input);process.stdout.write(JSON.stringify({input,modelConfig:{schema:permitIntentSchema,instructions:permitIntentInstructions}}));}
 else if(payload.mode==='intent-validate')process.stdout.write(JSON.stringify(validatePermitIntent(payload.intent,payload.input)));
 else if(payload.mode==='retrieve'){const input=cleanPermitQuestionInput(payload.input);process.stdout.write(JSON.stringify({...await retrievePermitQuestionSources(input,fetch,payload.intent??null),modelConfig:{schema:permitAnswerSchema,instructions:permitQuestionInstructions(input.language)}}));}
 else throw new PermitError(400,'invalid_permit_question');
}catch(error){process.stdout.write(JSON.stringify({error:error instanceof PermitError?error.code:'permit_question_sources_unavailable',status:error instanceof PermitError?error.status:502}));process.exitCode=1;}
