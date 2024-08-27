import axios from 'axios';
import { NetworkType, RecommendedFeeResponse } from '../types';

const networkHostMap = {
  Mainnet: 'https://mempool.space/',
  Testnet: 'http://localhost:3002/',
  Signet: 'https://mempool.space/',
};

const networkRouteMap = {
  Mainnet: 'api/',
  Testnet: '',
  Signet: 'signet/api/',
};

const getRecommendedFees = async (network: NetworkType): Promise<RecommendedFeeResponse> => {
  const { data } = await axios.get<RecommendedFeeResponse>(
    `${networkHostMap[network]}${networkRouteMap[network]}v1/fees/recommended`,
  );
  return data;
};

export default {
  getRecommendedFees,
};
