import express from 'express';
import { createHash } from 'node:crypto';
import { supabaseConfigured, studioFeedbackStore } from './supabaseStorage.js';

const fail = (message, status=400) => Object.assign(new Error(message), { status });
export function normalizeFeedbackInput(body) {
  const normalize = take => {
    if (!take || typeof take.id !== 'string' || !/^[\w-]{1,100}$/.test(take.id)) throw fail('Choose two recorded takes to get feedback.');
    const f=take.metrics;
    const bounds={duration:[1,1800],silenceRatio:[0,1],longPauseCount:[0,2000],pitchVariability:[0,2000]};
    const metrics={};
    for(const [key,[min,max]] of Object.entries(bounds)) {
      if (!f || typeof f[key]!=='number' || !Number.isFinite(f[key]) || f[key]<min || f[key]>max || (key==='longPauseCount'&&!Number.isInteger(f[key]))) throw fail('These takes do not contain valid delivery measurements.');
      metrics[key]=Number(f[key].toFixed(3));
    }
    return {id:take.id,metrics};
  };
  const before=normalize(body?.before),after=normalize(body?.after);
  if(before.id===after.id) throw fail('Choose two different takes.');
  return {before,after};
}
export function feedbackKey(input) { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
export async function generateStudioFeedback(input) {
  const response=await fetch(`${(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/+$/,'')}/chat/completions`,{
    method:'POST',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:'gpt-4.1-mini',max_tokens:300,temperature:0.2,response_format:{type:'json_object'},messages:[
      {role:'system',content:'You help someone rehearse a pitch. You receive only measured duration (seconds), silenceRatio, longPauseCount and pitchVariability (Hz) for two takes, NOT audio or words. Return JSON with observation and exercise, each a plain-text string of at most 220 characters. Observation: accurately describe one measured change, or a tie. Exercise: suggest one simple optional delivery experiment for their next take. Never claim to hear their voice or assess content, confidence, clarity, emotion, persuasiveness, speech rate, filler words or quality. Never infer pitch height from variability. Do not score, diagnose, or call shorter/fewer pauses better. Do not invent a target metric or universal ideal. No markdown. Refer to first and second take, not IDs.'},
      {role:'user',content:JSON.stringify({first:input.before.metrics,second:input.after.metrics})}
    ]})
  });
  if(!response.ok) throw fail('Feedback is temporarily unavailable.',503);
  const payload=await response.json();
  const choice=payload.choices?.[0];
  if(choice?.finish_reason!=='stop') throw fail('Feedback could not be completed.',503);
  let result;try{result=JSON.parse(choice.message.content);}catch{throw fail('Feedback could not be completed.',503);}
  for(const key of ['observation','exercise']) if(typeof result[key]!=='string'||!result[key].trim()||result[key].length>400) throw fail('Feedback could not be completed.',503);
  return {observation:result.observation.trim(),exercise:result.exercise.trim()};
}
export function createStudioFeedbackRouter({getStudentByToken,store=studioFeedbackStore,generate=generateStudioFeedback,enabled=()=>supabaseConfigured()&&Boolean(process.env.OPENAI_API_KEY)&&process.env.STUDIO_FEEDBACK_ENABLED!=='false'}={}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.get('/config',(_req,res)=>res.json({feedbackEnabled:enabled(),inviteRequired:Boolean(process.env.PRELIGHT_INVITE_CODE||process.env.GREEN_ROOM_INVITE_CODE)}));
  router.use(async(req,res,next)=>{
    const token=/^Bearer\s+(.+)$/i.exec(req.get('authorization')||'')?.[1]?.trim();
    if(!token)return res.status(401).json({error:'Sign in to get your feedback.'});
    try{const student=await getStudentByToken(token);if(!student)return res.status(401).json({error:'Please sign in again.'});req.student=student;next();}
    catch{return res.status(503).json({error:'Sign-in is temporarily unavailable. Please try again.'});}
  });
  router.get('/feedback',async(req,res)=>{
    if(!enabled())return res.status(503).json({error:'Feedback is temporarily unavailable.'});
    try{const quota=await store.quota(req.student.id);return res.json(quota);}catch{return res.status(503).json({error:'Feedback is temporarily unavailable.'});}
  });
  router.post('/feedback',async(req,res)=>{
    if(!enabled())return res.status(503).json({error:'Feedback is temporarily unavailable.'});
    let input;try{input=normalizeFeedbackInput(req.body);}catch(e){return res.status(400).json({error:e.message});}
    const key=feedbackKey(input);let reservation;
    try{reservation=await store.reserve(req.student.id,key);}catch{return res.status(503).json({error:'Could not check your daily allowance. Please try again.'});}
    if(reservation.status==='limit'){
      res.set('Retry-After',String(Math.max(1,Math.ceil((Date.parse(reservation.resetAt)-Date.now())/1000))));
      return res.status(429).json({...reservation,error:'You’ve used today’s five feedback sessions. You can keep recording and comparing. Your allowance resets at midnight UTC.'});
    }
    if(reservation.status==='completed')return res.json(reservation);
    if(reservation.status==='pending')return res.status(202).json({...reservation,message:'Your feedback is being prepared. Check again shortly.'});
    if(reservation.status==='failed')return res.status(503).json({...reservation,error:'Feedback for this pair could not be completed. This attempt counted toward today’s allowance. You can keep practicing.'});
    if(reservation.status!=='reserved')return res.status(503).json({error:'Feedback is temporarily unavailable.'});
    try{
      const feedback=await generate(input);
      await store.complete(req.student.id,key,feedback);
      return res.json({...reservation,status:'completed',feedback});
    }catch{
      try{await store.failed(req.student.id,key);}catch{/* Fail closed: keep the reservation to prevent duplicate charges. */}
      return res.status(503).json({...reservation,status:'failed',error:'Feedback could not be completed. This attempt counted toward today’s allowance. Recording and comparison still work.'});
    }
  });
  return router;
}
