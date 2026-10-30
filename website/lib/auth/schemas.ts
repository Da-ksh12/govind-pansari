import { z } from 'zod';
import { isValidIndianMobile } from './phone';

// What a visitor may type, checked before anything is sent. The server still validates everything; this only gives quick, kind feedback.
export const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, 'Enter your mobile number.')
    .refine((v) => isValidIndianMobile(v), 'Enter a valid 10-digit Indian mobile number.'),
});

export const otpSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your name.').max(80, 'That name is too long.'),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email address.').max(120)]),
});

export type PhoneForm = z.infer<typeof phoneSchema>;
export type OtpForm = z.infer<typeof otpSchema>;
export type ProfileForm = z.infer<typeof profileSchema>;
