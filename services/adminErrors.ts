// What to tell an admin when one of the admin-panel database functions refuses or fails. Pure, so tests/unit covers it.
//
// The functions' own refusals are written to be read ("the end must be after the start", "free delivery must start at or above the minimum order (250)")
// and are passed through. A missing function means a database update has not been applied; anything that looks like raw database output is replaced.

export function describeAdminWriteError(error: { code?: string | null; message?: string | null } | null | undefined, what: string): string {
  const message = (error?.message ?? '').trim();
  if (error?.code === 'PGRST202' || /could not find the function/i.test(message)) {
    return `Saving ${what} needs a database update that has not been applied yet. Ask the developer to apply the latest migrations.`;
  }
  if (/^not authorized$/i.test(message)) return `You don't have permission to change ${what}.`;
  const looksRaw = /relation |constraint|column |duplicate key|violates|syntax error|permission denied|does not exist|schema cache|invalid input/i.test(message);
  if (!message || message.length > 200 || looksRaw) return `Couldn't save ${what}. Please try again.`;
  return message;
}
