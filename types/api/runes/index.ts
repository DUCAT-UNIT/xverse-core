import { BigNumber } from '../../../utils/bignumber';
import { FungibleToken } from '../shared';

type BigNullable = BigNumber | null;

export type EncodePayload = {
  edicts: Edict[];
  pointer?: number;
};

export type Rune = {
  entry: {
    block: BigNumber;
    burned: BigNumber;
    divisibility: BigNumber;
    etching: string;
    mints: BigNumber;
    number: BigNumber;
    premine: BigNumber;
    spaced_rune: string;
    symbol: string;
    terms: {
      amount: BigNullable;
      cap: BigNullable;
      height: [BigNullable, BigNullable];
      offset: [BigNullable, BigNullable];
    };
    timestamp: BigNumber;
  };
  id: string;
  mintable: boolean;
  parent: string | null;
};

export type Cenotaph = {
  etching?: BigNumber;
  flaws: number;
  mint?: string;
};

export type Artifact = {
  Cenotaph?: Cenotaph;
  Runestone?: Runestone;
};

export type Runestone = {
  edicts: Edict[];
  etching?: Etching;
  mint?: string | null;
  pointer?: BigNullable;
};

export type Edict = {
  id: string;
  amount: BigNumber;
  output: BigNumber;
};

export type Etching = {
  divisibility?: BigNumber;
  premine?: BigNumber;
  rune?: string;
  spacers: BigNumber;
  symbol?: string;
  terms?: Terms;
};

export type Terms = {
  amount?: BigNumber;
  cap?: BigNumber;
  height: [BigNullable, BigNullable];
  offset: [BigNullable, BigNullable];
};

export type SpacedRune = {
  rune_number: BigNumber;
  rune_name: string;
  spacers: BigNumber;
};

export type EncodeResponse = {
  payload: string;
  codecVersion: string;
};

export const runeTokenToFungibleToken = (name: string, balance: BigNumber, decimals: number): FungibleToken => ({
  name,
  decimals,
  principal: name,
  balance: balance.toString(),
  total_sent: '',
  total_received: '',
  assetName: name,
  visible: true,
  ticker: '',
  protocol: 'runes',
});
