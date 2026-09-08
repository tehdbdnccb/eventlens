import {describe,expect,it} from 'vitest';
import {fairProbability,orderBookImbalance,scoreSignal} from './index.js';
describe('quant engine',()=>{it('returns a probability in range',()=>expect(fairProbability(101,100,.8,900)).toBeGreaterThanOrEqual(.01));it('computes book imbalance',()=>expect(orderBookImbalance([{quantity:3}],[{quantity:1}])).toBe(.5));it('weights edge',()=>expect(scoreSignal(.1,0,0,0)).toBe(.055));});
