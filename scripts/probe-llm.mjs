const { LLM_BASE_URL:baseUrl, LLM_MODEL:model, LLM_API_KEY:key }=process.env;
if(!baseUrl||!model||!key)throw new Error('Server-only LLM configuration is incomplete.');
const started=Date.now();
const response=await fetch(`${baseUrl.replace(/\/$/,'')}/chat/completions`,{
 method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
 body:JSON.stringify({model,temperature:0.3,max_tokens:400,stream:false,response_format:{type:'json_object'},
  messages:[{role:'system',content:'한국어로 대화하는 다정한 캐릭터입니다. JSON 객체 {"segments":["짧은 인사", "한 가지 질문"]}만 반환하세요. 분석이나 숨은 추론을 출력하지 마세요.'},{role:'user',content:'안녕. 오늘 처음 왔어.'}]}),
 signal:AbortSignal.timeout(60000),
});
const payload=await response.json();
if(!response.ok){console.log(JSON.stringify({status:response.status,errorCodes:payload.errors?.map(item=>item.code)??[payload.error?.code],latencyMs:Date.now()-started}));process.exitCode=1;}
else{console.log(JSON.stringify({status:response.status,model:payload.model,finishReason:payload.choices?.[0]?.finish_reason,content:payload.choices?.[0]?.message?.content,usage:payload.usage,latencyMs:Date.now()-started},null,2));}
