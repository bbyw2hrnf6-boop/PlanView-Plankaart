// Local-only bridge to the same source engine used by the Cloud Worker.
import {fetchPointCorpus} from './rule-sources.mjs';
import {cleanRuleInput,rankRuleSources,ruleAnswerSchema,ruleInstructions,validateRuleAnswer} from './rule-answer.mjs';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>150000)throw Error('request_too_large');}
try{const payload=JSON.parse(raw);if(payload.mode==='validate'){process.stdout.write(JSON.stringify(validateRuleAnswer(payload.answer,payload.sources)));}
 else{const input=cleanRuleInput(payload.input);const corpus=rankRuleSources(await fetchPointCorpus(input.point,payload.key),input.query);process.stdout.write(JSON.stringify({...corpus,modelConfig:{schema:ruleAnswerSchema,instructions:ruleInstructions}}));}}
catch{process.stdout.write(JSON.stringify({error:'rule_sources_unavailable'}));process.exitCode=1;}
