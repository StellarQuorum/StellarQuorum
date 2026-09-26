import {
  FreighterError,
  FreighterErrorCode,
  getFreighterAddress,
  isFreighterAvailable,
  signWithFreighter,
} from '../src/freighter';
import * as root from '../src/index';

const mockRequestAccess = jest.fn();
const mockSignTransaction = jest.fn();
const mockIsConnected = jest.fn();

jest.mock('@stellar/freighter-api', () => ({
  requestAccess: () => mockRequestAccess(),
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  isConnected: () => mockIsConnected(),
}));

const XDR = 'AAAAZ21pbmc=';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

/** Awaits a rejection and asserts it is a typed FreighterError. */
async function failure(promise: Promise<unknown>): Promise<FreighterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FreighterError);
    return error as FreighterError;
  }
  throw new Error('expected the call to reject');
}

const connect = () => mockRequestAccess.mockResolvedValue({ address: ADDRESS });

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  jest.resetAllMocks();
  connect();
  mockSignTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED', signerAddress: ADDRESS });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('signing', () => {
  it('detects, requests access and signs the built XDR', async () => {
    const signed = await signWithFreighter(XDR, { networkPassphrase: PASSPHRASE });

    expect(signed).toEqual({ signedXdr: 'SIGNED', signerAddress: ADDRESS });
    expect(mockRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockSignTransaction).toHaveBeenCalledWith(XDR, {
      networkPassphrase: PASSPHRASE,
      address: ADDRESS,
    });
  });

  it('signs with the requested address when one is given', async () => {
    mockSignTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED', signerAddress: ADDRESS });
    await signWithFreighter(XDR, { networkPassphrase: PASSPHRASE, address: ADDRESS });
    expect(mockSignTransaction).toHaveBeenCalledWith(XDR, {
      networkPassphrase: PASSPHRASE,
      address: ADDRESS,
    });
  });

  it('falls back to the connected address when Freighter omits the signer', async () => {
    mockSignTransaction.mockResolvedValue({ signedTxXdr: 'SIGNED' });
    const signed = await signWithFreighter(XDR, { networkPassphrase: PASSPHRASE });
    expect(signed.signerAddress).toBe(ADDRESS);
  });

  it('rejects an empty XDR and a missing passphrase', async () => {
    await expect(signWithFreighter('', { networkPassphrase: PASSPHRASE }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(signWithFreighter(XDR, { networkPassphrase: '' }))
      .rejects.toBeInstanceOf(TypeError);
    expect(mockRequestAccess).not.toHaveBeenCalled();
  });
});

describe('typed errors', () => {
  it('NOT_INSTALLED when there is no browser environment', async () => {
    Reflect.deleteProperty(globalThis, 'window');

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.NotInstalled);
    expect(error.message).toContain('Freighter is not available');
    expect(mockRequestAccess).not.toHaveBeenCalled();
  });

  it('NOT_INSTALLED when the wallet reports itself missing', async () => {
    mockRequestAccess.mockResolvedValue({ error: { code: 1, message: 'Freighter is not installed' } });

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.NotInstalled);
  });

  it('LOCKED when the wallet is locked', async () => {
    mockRequestAccess.mockResolvedValue({ error: { code: 2, message: 'The wallet is locked' } });

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.Locked);
    expect(error.message).toContain('Unlock the extension');
  });

  it('ACCESS_DENIED when the connection request is declined', async () => {
    mockRequestAccess.mockResolvedValue({ error: { code: 3, message: 'User declined access' } });

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.AccessDenied);
  });

  it('ACCESS_DENIED when Freighter returns no address', async () => {
    mockRequestAccess.mockResolvedValue({});

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.AccessDenied);
  });

  it('SIGNING_REJECTED when the user rejects the signature', async () => {
    mockSignTransaction.mockResolvedValue({ error: { code: 4, message: 'User rejected the transaction' } });

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.SigningRejected);
    expect(error.message).toContain('User rejected the transaction');
  });

  it('SIGNING_REJECTED when Freighter throws while signing', async () => {
    mockSignTransaction.mockRejectedValue(new Error('The user declined to sign'));

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.SigningRejected);
  });

  it('WALLET_ERROR when Freighter returns no signed transaction', async () => {
    mockSignTransaction.mockResolvedValue({});

    const error = await failure(signWithFreighter(XDR, { networkPassphrase: PASSPHRASE }));
    expect(error.code).toBe(FreighterErrorCode.WalletError);
  });
});

describe('detection helpers', () => {
  it('isFreighterAvailable is false without a browser and never throws', async () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(await isFreighterAvailable()).toBe(false);
  });

  it('isFreighterAvailable reflects the wallet state', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    expect(await isFreighterAvailable()).toBe(true);

    mockIsConnected.mockResolvedValue({ isConnected: false });
    expect(await isFreighterAvailable()).toBe(false);

    mockIsConnected.mockResolvedValue({ error: { message: 'Freighter is not installed' } });
    expect(await isFreighterAvailable()).toBe(false);
  });

  it('getFreighterAddress returns the connected address', async () => {
    expect(await getFreighterAddress()).toBe(ADDRESS);
    expect(mockRequestAccess).toHaveBeenCalledTimes(1);
    expect(mockSignTransaction).not.toHaveBeenCalled();
  });

  it('getFreighterAddress surfaces a locked wallet as LOCKED', async () => {
    mockRequestAccess.mockResolvedValue({ error: { message: 'wallet locked' } });
    const error = await failure(getFreighterAddress());
    expect(error.code).toBe(FreighterErrorCode.Locked);
  });
});

describe('optional entry point', () => {
  it('the package root does not expose the Freighter helper', () => {
    expect(root).not.toHaveProperty('signWithFreighter');
    expect(root).not.toHaveProperty('FreighterError');
  });
});
