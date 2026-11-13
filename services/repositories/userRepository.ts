import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { addressRepository } from './addressRepository';
import { avatarImg } from '../../data/images';
import type { Address, UserProfile, UserRole } from '../../types/models';

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  role: UserRole;
}

function toUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.full_name ?? 'Govind Pansari Customer',
    hasName: !!row.full_name && row.full_name.trim().length > 0,
    phone: row.phone ?? '',
    email: row.email ?? undefined,
    avatarUrl: row.avatar_url ?? avatarImg(row.id),
    // Loyalty/wallet/premium-tier features have no backing tables yet
    // (out of scope through Phase 03) — honest defaults, not mock
    // numbers, so the UI doesn't imply a system that doesn't exist.
    isPremium: false,
    loyaltyPoints: 0,
    walletBalance: 0,
    memberSince: row.created_at,
    role: row.role,
  };
}

export interface ProfileUpdateInput {
  fullName?: string;
  email?: string;
  avatarUrl?: string;
}

/** There is no session. Unlike a network error, trying again cannot fix this. */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
  }
}

export const userRepository = {
  /**
   * Deletes the signed-in customer's own account (Google Play / App Store requirement). The `delete-account` edge function removes the
   * personal data, strips names and addresses from old orders and closes the sign-in. It answers in plain words (e.g. an order still on its
   * way), which are passed on as the error message. The caller signs out afterwards.
   */
  async deleteAccount(): Promise<void> {
    const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
    if (error) {
      const response = (error as { context?: Response }).context;
      const detail = response && typeof response.clone === 'function' ? await response.clone().json().catch(() => null) : null;
      throw new Error(typeof detail?.error === 'string' ? detail.error : "We couldn't delete your account. Please check your connection and try again.");
    }
    if (!(data as { success?: boolean } | null)?.success) throw new Error("We couldn't delete your account. Please try again.");
  },

  /**
   * The signed-in user's profile. Pass `userId` when the caller already has it (the auth listener does): the id then costs no
   * request at all, where `auth.getUser()` is a server round trip that fails on a weak connection before the profile is even asked for.
   */
  async getProfile(userId?: string): Promise<UserProfile> {
    let id = userId;
    if (!id) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new NotSignedInError();
      id = session.user.id;
    }

    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (error) throw toCatalogueError(error);
    return toUserProfile(data as ProfileRow);
  },

  async updateProfile(input: ProfileUpdateInput): Promise<UserProfile> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');

    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.email !== undefined) patch.email = input.email;
    if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;

    // Column grants (see supabase/migrations) allow only full_name/
    // email/avatar_url here — role/is_active/phone are not in this
    // patch and would be rejected by Postgres even if included.
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.id).select('*').single();
    if (error) throw toCatalogueError(error);
    return toUserProfile(data as ProfileRow);
  },

  async listAddresses(): Promise<Address[]> {
    return addressRepository.list();
  },
};
