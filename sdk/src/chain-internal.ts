import type { CoinCore } from './coinfile';
import { ownerOf } from './layout';

export function currentOwnerOf(coin: CoinCore): Buffer {
  return ownerOf(coin.states[coin.states.length - 1]);
}
