import { PROPOSALS, getProposalById } from '../frontend/lib/proposals';

describe('proposals data', () => {
  it('should have 8 proposals', () => {
    expect(PROPOSALS).toHaveLength(8);
  });

  it('should find proposal by id', () => {
    const p = getProposalById('QIP-001');
    expect(p).toBeDefined();
    expect(p?.title).toContain('Fee');
  });

  it('should return undefined for unknown id', () => {
    expect(getProposalById('QIP-999')).toBeUndefined();
  });

  it('should have at least 2 active proposals', () => {
    const active = PROPOSALS.filter(p => p.status === 'active');
    expect(active.length).toBeGreaterThanOrEqual(2);
  });
});
