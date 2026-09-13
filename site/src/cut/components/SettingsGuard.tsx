"use client";

import { useEffect, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { signInUrl } from "@/cut/lib/generate";
import { useHydrationSafeSession } from "@/lib/auth-client";

// Session guard for Cut's billing and usage pages. Signed-out visitors go
// through the same host-aware sign-in flow as the editor's generation
// surfaces (signInUrl): the same-host sign-in page (Google's redirect_uri is
// pinned to the auth-owning host). Reading window.location is safe from
// hydration mismatch: the redirect runs only after the client session resolves.
// useHydrationSafeSession (not the raw authClient.useSession) matters here
// specifically: a page reached via a fresh top-level navigation — like the
// "Accept invite" link in an email — hits this on first paint, where the raw
// hook can already have a resolved session while SSR rendered the
// unresolved default. React then discards and rebuilds this whole subtree to
// reconcile the mismatch, remounting whatever's inside — disastrous for a
// child that fires a one-time action on mount (e.g. StudioInvitePage's
// accept-the-invite call), since every forced remount fires it again.
export function SettingsGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useHydrationSafeSession();

  useEffect(() => {
    if (isPending || session) return;
    window.location.assign(signInUrl());
  }, [isPending, session]);

  if (isPending || !session) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
