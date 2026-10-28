import { useQueries } from "@tanstack/react-query";
import { api, type Account } from "../../lib/api";
export type MailFolder = {
  id: string;
  key: string;
  name: string;
  kind: string;
};
export type MailProfile = {
  identities: { address: string; name: string; primary: boolean }[];
  folders: MailFolder[];
  needs_reconnect: boolean;
};
export function useMailProfiles(accounts: Account[]) {
  const queries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: ["mail-profile", account.id],
      queryFn: () =>
        api<MailProfile>("/email/mailboxes/" + account.id + "/profile"),
      staleTime: 600000,
      enabled: account.can_read
    }))
  });
  return accounts.map((account, index) => ({ account, ...queries[index] }));
}
