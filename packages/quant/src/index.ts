export const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
export function erf(x:number){const sign=x<0?-1:1; x=Math.abs(x); const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911; const t=1/(1+p*x); return sign*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x));}
export const normalCdf=(x:number)=>0.5*(1+erf(x/Math.sqrt(2)));
export const logReturn=(current:number,open:number)=>Math.log(current/open);
export function fairProbability(current:number,open:number,annualVol:number,tauSeconds:number){const tau=Math.max(tauSeconds,1)/31536000; const z=logReturn(current,open)/(Math.max(annualVol,.0001)*Math.sqrt(tau)); return clamp(normalCdf(z),.01,.99);}
export function orderBookImbalance(bids:{quantity:number}[],asks:{quantity:number}[]){const bid=bids.reduce((s,x)=>s+x.quantity,0), ask=asks.reduce((s,x)=>s+x.quantity,0); return (bid-ask)/Math.max(bid+ask,1e-9);}
export function momentum(current:number,open:number){return (current-open)/open;}
export function crossWindowDeviation(current:number, peers:number[]){if(!peers.length)return 0; const avg=peers.reduce((a,b)=>a+b,0)/peers.length; return clamp((current-avg)*4,-1,1);}
export function scoreSignal(edge:number,obi:number,mom:number,term:number){return .55*edge+.20*obi+.10*clamp(mom*10,-1,1)+.15*term;}
export function confidence(edge:number,obi:number,mom:number,term:number){return clamp(50+Math.abs(edge)*500+Math.abs(obi)*15+Math.abs(term)*15+Math.abs(mom)*100,0,99);}
