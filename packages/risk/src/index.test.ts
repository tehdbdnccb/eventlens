import {describe,expect,it} from 'vitest'; import {evaluateTrade} from './index.js';
const m:any={status:'TRADING',expiry:Date.now()+600000,liquidity:10000,upPrice:.6,downPrice:.4,spread:.005}; const s:any={edge:.08,confidence:80};
describe('risk engine',()=>{it('allows a sane trade',()=>expect(evaluateTrade(m,s,'UP',5,0).allowed).toBe(true));it('blocks oversized trades',()=>expect(evaluateTrade(m,s,'UP',11,0).allowed).toBe(false));});
