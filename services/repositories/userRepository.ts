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

export const userRepository = {
  async getProfile(): Promise<UserProfile> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');

    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
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
