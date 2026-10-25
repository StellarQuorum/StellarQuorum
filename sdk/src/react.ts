import { useCallback, useEffect, useState } from 'react';
import type { QuorumClient } from './client.js';
import type { GetProposalsOptions, Proposal, ReadOptions, VoteSupport } from './types.js';

export interface UseQueryResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
}

function useQuery<T>(load: () => Promise<T>, enabled = true): UseQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try { setData(await load()); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error(String(cause))); }
    finally { setIsLoading(false); }
  }, [load]);
  useEffect(() => { if (enabled) void refetch(); }, [enabled, refetch]);
  return { data, error, isLoading, loading: isLoading, refetch };
}

/** Loads one proposal and refreshes it when the client or id changes. */
export function useProposal(client: QuorumClient, id: bigint | null, options?: ReadOptions): UseQueryResult<Proposal | null> {
  const load = useCallback(() => client.getProposal(id as bigint, options), [client, id, options]);
  return useQuery(load, id !== null);
}

/** Loads proposals matching the supplied pagination and status options. */
export function useProposals(client: QuorumClient, options?: GetProposalsOptions): UseQueryResult<Proposal[]> {
  const load = useCallback(() => client.getProposals(options), [client, options]);
  return useQuery(load);
}

/** Reads the recorded vote for a voter, or null when they have not voted. */
export function useVote(client: QuorumClient, proposalId: bigint | null, voter: string | null, options?: ReadOptions): UseQueryResult<VoteSupport | null> {
  const load = useCallback(() => client.getVote(proposalId as bigint, voter as string, options), [client, proposalId, voter, options]);
  return useQuery(load, proposalId !== null && voter !== null);
}
