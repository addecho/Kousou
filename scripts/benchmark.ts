import { calculate, examplePlan, ruleDefaults } from "../packages/core/src/index.js";
const plan = examplePlan();
plan.lines = Array.from({ length: 20 }, (_, i) => ({ ...plan.lines[0], id: `line-${i}`, directOff: '0' }));
plan.rules = Array.from({ length: 8 }, (_, i) => ({ ...ruleDefaults, id: `coupon-${i}`, name: `Coupon ${i}`, stage: 'platform' as const, exclusiveGroup: '', verified: true, amount: '100' }));
const times: number[] = [];
for(let i=0;i<30;i++){const start=performance.now();calculate(plan);times.push(performance.now()-start);}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({lines:20,platformRules:8,runs:30,medianMs:times[15],p95Ms:times[28],maxMs:times[29]}));
