/* eslint-disable max-len */
import BigNumber from 'bignumber.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BitcoinEsploraApiProvider from '../../api/esplora/esploraAPiProvider';
import * as XverseAPIFunctions from '../../api/xverse';
import {
  Recipient,
  calculateFee,
  createTransaction,
  defaultFeeRate,
  filterUtxos,
  getBtcFees,
  getBtcFeesForOrdinalSend,
  getBtcFeesForOrdinalTransaction,
  getFee,
  selectUnspentOutputs,
  signBtcTransaction,
  signOrdinalSendTransaction,
  signOrdinalTransaction,
  sumUnspentOutputs,
} from '../../transactions/btc';
import * as BTCFunctions from '../../transactions/btc.utils';
import { Inscription, UTXO } from '../../types';
import { getBtcPrivateKey } from '../../wallet';
import { testSeed } from '../mocks/restore.mock';

describe('UTXO selection', () => {
  const createUtxo = (value: number, confirmed: boolean): UTXO => ({
    address: 'address',
    txid: 'txid',
    vout: 0,
    value,
    status: {
      confirmed,
      block_height: confirmed ? 123123 : undefined,
      block_time: confirmed ? 1677048365 : undefined,
      block_hash: confirmed ? 'block_hash' : undefined,
    },
  });

  it('selects UTXO of highest value first', () => {
    const testUtxos = [createUtxo(10000, true), createUtxo(20000, true)];

    const utxos = selectUnspentOutputs(new BigNumber(10000), 22, [...testUtxos], undefined);

    expect(utxos.length).eq(1);
    expect(utxos[0]).toBe(testUtxos[1]);
  });

  it('selects multiple UTXOs if needed', () => {
    const testUtxos = [createUtxo(10000, true), createUtxo(20000, true)];

    const utxos = selectUnspentOutputs(new BigNumber(25000), 22, [...testUtxos], undefined);

    expect(utxos.length).eq(2);
    expect(utxos[0]).toBe(testUtxos[1]);
    expect(utxos[1]).toBe(testUtxos[0]);
  });

  it('deprioritises unconfirmed UTXOs', () => {
    const testUtxos = [createUtxo(10000, true), createUtxo(20000, true), createUtxo(30000, false)];

    const utxos = selectUnspentOutputs(new BigNumber(10000), 22, [...testUtxos], undefined);
    expect(utxos.length).eq(1);
    expect(utxos[0]).toBe(testUtxos[1]);
  });

  it('Uses unconfirmed UTXOs if sats to send high enough', () => {
    const testUtxos = [createUtxo(10000, true), createUtxo(20000, true), createUtxo(30000, false)];

    let utxos = selectUnspentOutputs(new BigNumber(30000), 22, [...testUtxos], undefined);
    expect(utxos.length).eq(2);
    expect(utxos[0]).toBe(testUtxos[1]);
    expect(utxos[1]).toBe(testUtxos[0]);

    utxos = selectUnspentOutputs(new BigNumber(40000), 22, [...testUtxos], undefined);
    expect(utxos.length).eq(3);
    expect(utxos[0]).toBe(testUtxos[1]);
    expect(utxos[1]).toBe(testUtxos[0]);
    expect(utxos[2]).toBe(testUtxos[2]);
  });

  it('Ignores UTXOs if they are dust at desired fee rate', () => {
    const testUtxos = [createUtxo(10000, true), createUtxo(20000, true), createUtxo(30000, false)];

    // This should make the 10000 UTXO dust at the desired fee rate
    // as adding it would increase the fee by 10500 (more than the value of the UTXO)
    const utxos = selectUnspentOutputs(new BigNumber(30000), 150, [...testUtxos], undefined);
    expect(utxos.length).eq(2);
    expect(utxos[0]).toBe(testUtxos[1]);
    expect(utxos[1]).toBe(testUtxos[2]);
  });
});

describe('bitcoin transactions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('can create a wrapped segwit transaction single recipient', async () => {
    const network = 'Mainnet';
    const privateKey = await getBtcPrivateKey({
      seedPhrase: testSeed,
      index: BigInt(0),
      network,
    });
    const unspent1Value = 10000;
    const selectedUnspentOutputs: Array<UTXO> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT',
      },
    ];

    const satsToSend = new BigNumber(8000);
    const recipient1Amount = new BigNumber(6000);
    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: recipient1Amount,
      },
    ];

    const changeAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const signedTx = createTransaction(
      privateKey,
      selectedUnspentOutputs,
      satsToSend,
      recipients,
      changeAddress,
      network,
    );

    expect(signedTx.inputsLength).eq(1);
    expect(signedTx.outputsLength).eq(2);
    expect(signedTx.getOutput(0).amount).eq(BigInt(recipient1Amount.toNumber()));
    expect(signedTx.getOutput(1).amount).eq(BigInt(new BigNumber(unspent1Value).minus(satsToSend).toNumber()));
  });

  it('can create a wrapped segwit transaction multi recipient', async () => {
    const network = 'Mainnet';
    const privateKey = await getBtcPrivateKey({
      seedPhrase: testSeed,
      index: BigInt(0),
      network,
    });
    const unspent1Value = 100000;
    const unspent2Value = 200000;
    const unspent3Value = 300000;
    const totalUnspentValue = unspent1Value + unspent2Value + unspent3Value;

    const selectedUnspentOutputs: Array<UTXO> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT',
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent2Value,
        address: '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT',
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8e',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent3Value,
        address: '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT',
      },
    ];

    const satsToSend = new BigNumber(300800);
    const recipient1Amount = new BigNumber(200000);
    const recipient2Amount = new BigNumber(100000);

    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: recipient1Amount,
      },
      {
        address: '18xdKbDgTKjTZZ9jpbrPax8X4qZeHG6b65',
        amountSats: recipient2Amount,
      },
    ];

    const changeAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const signedTx = createTransaction(
      privateKey,
      selectedUnspentOutputs,
      satsToSend,
      recipients,
      changeAddress,
      network,
    );

    expect(signedTx.inputsLength).eq(3);
    expect(signedTx.outputsLength).eq(3);
    expect(signedTx.getOutput(0).amount).eq(BigInt(recipient1Amount.toNumber()));
    expect(signedTx.getOutput(1).amount).eq(BigInt(recipient2Amount.toNumber()));
    expect(signedTx.getOutput(2).amount).eq(BigInt(totalUnspentValue - satsToSend.toNumber()));
  });

  it('can calculate transaction fee legacy function', async () => {
    const network = 'Mainnet';

    const unspent1Value = 100000;
    const unspent2Value = 200000;
    const unspent3Value = 250000;

    const changeAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: changeAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent2Value,
        address: changeAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8e',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent3Value,
        address: changeAddress,
      },
    ];

    const recipient1Amount = 200000;
    const recipient2Amount = 100000;

    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: new BigNumber(recipient1Amount),
      },
      {
        address: '18xdKbDgTKjTZZ9jpbrPax8X4qZeHG6b65',
        amountSats: new BigNumber(recipient2Amount),
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = defaultFeeRate;
    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const mockEsploraProvider = {
      getUnspentUtxos: vi.fn(),
    };
    mockEsploraProvider.getUnspentUtxos.mockResolvedValueOnce(utxos);

    const { fee } = await getBtcFees(
      recipients,
      changeAddress,
      mockEsploraProvider as any as BitcoinEsploraApiProvider,
      network,
    );

    // expect transaction size to be 294 bytes;
    const txSize = 294;
    expect(fee.toNumber()).eq(txSize * feeRate.regular);
  });

  it('can calculate ordinal send transaction fee legacy function', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 10000;

    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';
    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: ordinalValue,
        address: ordinalAddress,
      },
      {
        status: {
          block_hash: '00000000000000000003e6c56ae100b34fcc2967bc1deb53de1a4b9c29ba448f',
          block_height: 797404,
          block_time: 1688626274,
          confirmed: true,
        },
        txid: 'd0dfe638a5be4f220f6435616edb5909a2f93540a7d6975ed0bdf305fb8bf51c',
        value: 1347,
        vout: 0,
        address: ordinalAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: btcAddress,
      },
      ...ordinalOutputs,
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = defaultFeeRate;
    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const ordinalUtxos = [
      {
        status: {
          block_hash: '00000000000000000003e6c56ae100b34fcc2967bc1deb53de1a4b9c29ba448f',
          block_height: 797404,
          block_time: 1688626274,
          confirmed: true,
        },
        txid: 'd0dfe638a5be4f220f6435616edb5909a2f93540a7d6975ed0bdf305fb8bf51c',
        value: 1347,
        vout: 0,
        address: btcAddress,
      },
    ];

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(utxos);
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(ordinalOutputs);

    const { fee } = await getBtcFeesForOrdinalSend(
      recipientAddress,
      ordinalOutputs[0],
      btcAddress,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
      ordinalUtxos,
    );

    // expect transaction size to be 260 bytes;
    const txSize = 260;
    expect(fee.toNumber()).eq(txSize * feeRate.regular);
  });

  it('can calculate transaction fee', async () => {
    const network = 'Mainnet';

    const unspent1Value = 100000;
    const unspent2Value = 200000;
    const unspent3Value = 250000;

    const changeAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: changeAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent2Value,
        address: changeAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8e',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent3Value,
        address: changeAddress,
      },
    ];

    const recipient1Amount = 200000;
    const recipient2Amount = 100000;
    const satsToSend = recipient1Amount + recipient2Amount;

    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: new BigNumber(recipient1Amount),
      },
      {
        address: '18xdKbDgTKjTZZ9jpbrPax8X4qZeHG6b65',
        amountSats: new BigNumber(recipient2Amount),
      },
    ];

    const feeRate = defaultFeeRate;

    const selectedUnspentOutputs = selectUnspentOutputs(new BigNumber(satsToSend), feeRate.regular, utxos);

    const fee = await calculateFee(
      selectedUnspentOutputs,
      new BigNumber(satsToSend),
      recipients,
      new BigNumber(feeRate.regular),
      changeAddress,
      network,
    );

    // expect transaction size to be 294 bytes;
    const txSize = 294;
    expect(fee.toNumber()).eq(txSize * feeRate.regular);
  });

  it('can create + sign btc transaction', async () => {
    const network = 'Mainnet';

    const unspent1Value = 100000;
    const unspent2Value = 200000;
    const unspent3Value = 1000;
    const unspent4Value = 1000;

    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent2Value,
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8e',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent3Value,
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8f',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent4Value,
        address: btcAddress,
      },
    ];

    const recipient1Amount = 200000;
    const recipient2Amount = 100000;

    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: new BigNumber(recipient1Amount),
      },
      {
        address: '18xdKbDgTKjTZZ9jpbrPax8X4qZeHG6b65',
        amountSats: new BigNumber(recipient2Amount),
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = {
      limits: {
        min: 1,
        max: 5,
      },
      regular: 2,
      priority: 30,
    };
    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(utxos);

    const signedTx = await signBtcTransaction(
      recipients,
      btcAddress,
      0,
      testSeed,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
    );

    const tx =
      '020000000001038d9df5a92a53ca644ef51e53dcb51d041779a5e78a2e50b29d374da792bb2b1f0200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff8c9df5a92a53ca644ef51e53dcb51d041779a5e78a2e50b29d374da792bb2b1f0200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff8e9df5a92a53ca644ef51e53dcb51d041779a5e78a2e50b29d374da792bb2b1f0200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff02400d0300000000001976a914fe5c6cac4dd74c23ec8477757298eb137c50ff6388aca0860100000000001976a914574e13c50c3450713ff252a9ad7604db865135e888ac02483045022100b3633b3efc5049daa3a13b79b0c2003f926e1b6c19d20c288b3748608461eb070220648e681052ac71b737d9e4c92f6cdd1d628b5e358f2201974dad36854eb838310121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff02483045022100b48a4002b1d92370582d6922b78b717a4c935155191fb50adee44052e5f749f80220191a2b52514711c52f7b41b1cbd0289eb395cd24893bba943833bf74e72858ad0121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff0247304402203ea2f07f523f8b62587aa59a87cb952b3edf22c5fb5f8770c88f8cb146a4661002203218d643b5cf6a0da9fb8a3a2cffe755929f99054a805457e156712ddc8f388e0121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff00000000';
    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(1);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);
    expect(signedTx.fee.toNumber()).eq(signedTx.tx.vsize * feeRate.regular);
    expect(signedTx.signedTx).toEqual(tx);
  });

  it('can create + sign btc transaction with custom fees', async () => {
    const network = 'Mainnet';

    const unspent1Value = 100000;
    const unspent2Value = 200000;
    const unspent3Value = 1000;
    const unspent4Value = 1000;

    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent1Value,
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: unspent2Value,
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8e',
        value: unspent3Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8f',
        value: unspent4Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const recipient1Amount = 200000;
    const recipient2Amount = 100000;

    const recipients: Array<Recipient> = [
      {
        address: '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS',
        amountSats: new BigNumber(recipient1Amount),
      },
      {
        address: '18xdKbDgTKjTZZ9jpbrPax8X4qZeHG6b65',
        amountSats: new BigNumber(recipient2Amount),
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = defaultFeeRate;
    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const customFees = new BigNumber(500);

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(utxos);

    const signedTx = await signBtcTransaction(
      recipients,
      btcAddress,
      0,
      testSeed,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
      customFees,
    );

    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(0);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);
    expect(signedTx.fee.toNumber()).eq(customFees.toNumber());
  });

  it('fails to create transaction when insufficient balance after adding fees', async () => {
    const network = 'Mainnet';

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        address: '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe',
        blockHeight: 794533,
        status: {
          block_hash: '0000000000000000000437fc3765a3685b4dc7e2568221ef73a6642bc3ce09fb',
          block_height: 794533,
          block_time: 1686877112,
          confirmed: true,
        },
        txid: '357cd8a47fb6c5b9820c8fa9e7dd5ea1a588ada41761b303f87464d8faa352cd',
        value: 5500,
        vout: 0,
      },
      {
        address: '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe',
        blockHeight: 793556,
        status: {
          block_hash: '00000000000000000000a46de80f72757343c538d13be3a992aa733fe33bc4bb',
          block_height: 793556,
          block_time: 1686310361,
          confirmed: true,
        },
        txid: '8b330459af5329c06f8950fda313bbf2e51afc868e3b31c0e1a7acbca2fdffe6',
        value: 3911,
        vout: 1,
      },
      {
        address: '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe',
        blockHeight: 793974,
        status: {
          block_hash: '000000000000000000048adca1cd3d995e783f8dda3ce094d0feb0fa7ad35926',
          block_height: 793974,
          block_time: 1686540100,
          confirmed: true,
        },
        txid: '30ff5258040579963b58f066a48daeed5f695329c0afb89c055f72e166a69f42',
        value: 941,
        vout: 12,
      },
      {
        address: '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe',
        blockHeight: 793556,
        status: {
          block_hash: '00000000000000000000a46de80f72757343c538d13be3a992aa733fe33bc4bb',
          block_height: 793556,
          block_time: 1686310361,
          confirmed: true,
        },
        txid: '8b330459af5329c06f8950fda313bbf2e51afc868e3b31c0e1a7acbca2fdffe6',
        value: 5700,
        vout: 0,
      },
      {
        address: '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe',
        blockHeight: 792930,
        status: {
          block_hash: '0000000000000000000026351fde98eb0b9a3e6e3ea8feceef13186e719c91f5',
          block_height: 792930,
          block_time: 1685945805,
          confirmed: true,
        },
        txid: 'c761835d87e382037e2628431821cfa9a56811a02a0cb4032eb81b72ae9c6b32',
        value: 1510,
        vout: 1,
      },
    ];

    const recipient1Amount = 60000;

    const recipients: Array<Recipient> = [
      {
        address: '3FijEEhojeNqpt62bKbTbj3zvwghfwcPwK',
        amountSats: new BigNumber(recipient1Amount),
      },
    ];

    const btcAddress = '3Codr66EYyhkhWy1o2RLmrER7TaaHmtrZe';

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    expect(fetchFeeRateSpy.getMockName()).toEqual('fetchBtcFeeRate');
    const feeRate = defaultFeeRate;

    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(utxos);

    await expect(async () => {
      await signBtcTransaction(
        recipients,
        btcAddress,
        0,
        testSeed,
        esploraMock as any as BitcoinEsploraApiProvider,
        network,
      );
    }).rejects.toThrowError('601');

    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(1);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);
  });

  it('can create and sign ordinal send transaction', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 1000;
    const unspent2Value = 10000;

    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';
    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        value: ordinalValue,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: ordinalAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        value: unspent1Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        value: unspent2Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = defaultFeeRate;

    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const recipients = [
      {
        address: recipientAddress,
        amountSats: new BigNumber(ordinalOutputs[0].value),
      },
    ];

    const filteredUnspentOutputs = filterUtxos(utxos, [ordinalOutputs[0]]);

    const selectedUnspentOutputs = selectUnspentOutputs(
      new BigNumber(ordinalOutputs[0].value),
      feeRate.regular,
      filteredUnspentOutputs,
      ordinalOutputs[0],
    );

    const sumSelectedOutputs = sumUnspentOutputs(selectedUnspentOutputs);

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValueOnce(utxos);

    const signedTx = await signOrdinalSendTransaction(
      recipientAddress,
      ordinalOutputs[0],
      btcAddress,
      0,
      testSeed,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
      [ordinalOutputs[0]],
    );

    const { fee } = await getFee(
      filteredUnspentOutputs,
      selectedUnspentOutputs,
      sumSelectedOutputs,
      new BigNumber(ordinalOutputs[0].value),
      recipients,
      feeRate,
      btcAddress,
      network,
      ordinalOutputs[0],
    );

    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(1);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);

    // Needs a better transaction size calculator
    expect(signedTx.fee.toNumber()).eq(fee.toNumber());
  });

  it('can calculate fee for ordinal send transaction', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 1000;
    const unspent2Value = 10000;

    const ordinal = {
      output: '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143:2',
    };

    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalsAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';
    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: ordinalValue,
        address: ordinalsAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      ordinalOutputs[0],
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        value: unspent1Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        value: unspent2Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = {
      limits: {
        min: 1,
        max: 5,
      },
      regular: 10,
      priority: 30,
    };

    fetchFeeRateSpy.mockResolvedValueOnce(feeRate);

    const getOrdinalsByAddressSpy = vi.spyOn(XverseAPIFunctions, 'getOrdinalsByAddress');
    getOrdinalsByAddressSpy.mockResolvedValue([]);

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
      getOrdinalsUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValue(utxos);
    esploraMock.getOrdinalsUtxos.mockResolvedValue(ordinalOutputs);

    const { fee } = await getBtcFeesForOrdinalTransaction({
      recipientAddress,
      btcAddress,
      ordinalsAddress,
      esploraProvider: esploraMock as any as BitcoinEsploraApiProvider,
      network,
      ordinal: ordinal as Inscription,
    });

    const expectedFee = 2600;

    expect(fee.toNumber()).eq(expectedFee);
  });

  it('can sign ordinal send transaction', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 1000;
    const unspent2Value = 10000;

    const ordinal = {
      output: '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143:2',
    };

    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalsAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';
    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: ordinalValue,
        address: ordinalsAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      ordinalOutputs[0],
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        value: unspent1Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        value: unspent2Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = {
      limits: {
        min: 1,
        max: 5,
      },
      regular: 10,
      priority: 30,
    };

    fetchFeeRateSpy.mockReturnValue(Promise.resolve(feeRate));

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
      getOrdinalsUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValue(utxos);

    const fetchOrdinalsUtxoSpy = vi.spyOn(BTCFunctions, 'getOrdinalsUtxos');
    fetchOrdinalsUtxoSpy.mockReturnValue(Promise.resolve(ordinalOutputs));

    const signedTx = await signOrdinalTransaction({
      recipientAddress,
      btcAddress,
      ordinalsAddress,
      accountIndex: 0,
      seedPhrase: testSeed,
      esploraProvider: esploraMock as any as BitcoinEsploraApiProvider,
      network,
      ordinal: ordinal as Inscription,
    });

    const expectedTx =
      '020000000001024301a0618b6e3b06a03299ff753a937c31a894351bfd50b3ef0c1988b6cc41550200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff8d9df5a92a53ca644ef51e53dcb51d041779a5e78a2e50b29d374da792bb2b1f0200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff0280380100000000001976a914fe5c6cac4dd74c23ec8477757298eb137c50ff6388acde1c0000000000001976a914b101d5205c77b52f057cb66498572f3ffe16738688ac02483045022100c41bf44caae4f84d1244cd149de50ea398fca60acc6c35ca9a0f2f8cecc5f3db0220141d7ea586eac7e20abc5e0ddee090ab84a5561ba3361d4636e61737a666f6e40121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff0248304502210086a1161881664d09065a0e50bbf7dc4c32e01f4c7123cfff8a73637608fa25d6022060e1af3ee4b9b4fb3b22c74f246c05908f1754d83f7b6f335b903ff9e7d2bc030121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff00000000';
    expect(signedTx.signedTx).eq(expectedTx);
  });

  it('can create and sign ordinal send with ordinal utxo in payment address', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 1000;
    const unspent2Value = 10000;

    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';
    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        value: ordinalValue,
        address: ordinalAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      ordinalOutputs[0],
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        value: unspent1Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        value: unspent2Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = {
      limits: {
        min: 1,
        max: 5,
      },
      regular: 10,
      priority: 30,
    };

    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
      getOrdinalsUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValue(utxos);
    esploraMock.getOrdinalsUtxos.mockResolvedValue(ordinalOutputs);

    const signedTx = await signOrdinalSendTransaction(
      recipientAddress,
      ordinalOutputs[0],
      btcAddress,
      0,
      testSeed,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
      [ordinalOutputs[0]],
    );

    const expectedTx =
      '020000000001024301a0618b6e3b06a03299ff753a937c31a894351bfd50b3ef0c1988b6cc41550200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff8d9df5a92a53ca644ef51e53dcb51d041779a5e78a2e50b29d374da792bb2b1f0200000017160014883999913cffa58d317d4533c94cb94878788db3fdffffff0280380100000000001976a914fe5c6cac4dd74c23ec8477757298eb137c50ff6388acde1c0000000000001976a914b101d5205c77b52f057cb66498572f3ffe16738688ac02483045022100c41bf44caae4f84d1244cd149de50ea398fca60acc6c35ca9a0f2f8cecc5f3db0220141d7ea586eac7e20abc5e0ddee090ab84a5561ba3361d4636e61737a666f6e40121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff0248304502210086a1161881664d09065a0e50bbf7dc4c32e01f4c7123cfff8a73637608fa25d6022060e1af3ee4b9b4fb3b22c74f246c05908f1754d83f7b6f335b903ff9e7d2bc030121032215d812282c0792c8535c3702cca994f5e3da9cd8502c3e190d422f0066fdff00000000';
    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(1);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);
    expect(signedTx.signedTx).eq(expectedTx);
    // Needs a better transaction size calculator
    expect(signedTx.fee.toNumber()).eq(signedTx.tx.vsize * feeRate.regular);
  });

  it('can create and sign oridnal transaction with custom fees', async () => {
    const network = 'Mainnet';

    const ordinalValue = 80000;
    const unspent1Value = 1000;
    const unspent2Value = 10000;

    const recipientAddress = '1QBwMVYH4efRVwxydnwoGwELJoi47FuRvS';
    const ordinalAddress = 'bc1prtztqsgks2l6yuuhgsp36lw5n6dzpkj287lesqnfgktzqajendzq3p9urw';
    const btcAddress = '1H8voHF7NNoyz76h9s6dZSeoypJQamX4xT';
    const customFeeAmount = new BigNumber(2000);

    const ordinalUtxoHash = '5541ccb688190cefb350fd1b3594a8317c933a75ff9932a0063b6e8b61a00143';
    const ordinalOutputs: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: ordinalUtxoHash,
        value: ordinalValue,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: ordinalAddress,
      },
    ];

    const utxos: Array<UTXO & { address: string; blockHeight?: number }> = [
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8c',
        value: unspent1Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
      {
        txid: '1f2bbb92a74d379db2502e8ae7a57917041db5dc531ef54e64ca532aa9f59d8d',
        value: unspent2Value,
        vout: 2,
        status: {
          confirmed: true,
          block_height: 123123,
          block_time: 1677048365,
          block_hash: '000000000000000000072266ee093771d806cc9cb384461841f9edd40b52b67f',
        },
        address: btcAddress,
      },
    ];

    const fetchFeeRateSpy = vi.spyOn(XverseAPIFunctions, 'fetchBtcFeeRate');
    const feeRate = defaultFeeRate;

    fetchFeeRateSpy.mockImplementation(() => Promise.resolve(feeRate));

    const esploraMock = {
      getUnspentUtxos: vi.fn(),
      getOrdinalsUtxos: vi.fn(),
    };
    esploraMock.getUnspentUtxos.mockResolvedValue(utxos);
    esploraMock.getOrdinalsUtxos.mockResolvedValue(ordinalOutputs);

    const signedTx = await signOrdinalSendTransaction(
      recipientAddress,
      ordinalOutputs[0],
      btcAddress,
      0,
      testSeed,
      esploraMock as any as BitcoinEsploraApiProvider,
      network,
      [ordinalOutputs[0]],
      customFeeAmount,
    );

    expect(fetchFeeRateSpy).toHaveBeenCalledTimes(0);
    expect(esploraMock.getUnspentUtxos).toHaveBeenCalledTimes(1);
    expect(signedTx.fee.toNumber()).eq(customFeeAmount.toNumber());
  });
});
