"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { AccountManager } from "@/lib/supabase/database.types";
import { updateAccountManager } from "@/app/(app)/settings/users/actions";

/**
 * The account manager every generated CV names on its cover page.
 *
 * A small form rather than inline selects, because all three values change
 * together when the person does, and a half-changed cover page is worse than
 * an unchanged one.
 */
export function AccountManagerCard({ initial }: { initial: AccountManager }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    value.name !== initial.name || value.email !== initial.email || value.phone !== initial.phone;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateAccountManager(value);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-card">
      <h2 className="text-label-sm uppercase tracking-wide text-muted-foreground">
        Account manager on the CV cover page
      </h2>
      <p className="mt-1 text-body-sm text-muted-foreground">
        Printed on the cover of every CV the system generates, beside the date it was generated.
        Never stored on a candidate.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="am-name">Name</Label>
          <Input id="am-name" value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="am-email">Email address</Label>
          <Input id="am-email" type="email" value={value.email} onChange={(e) => setValue({ ...value, email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="am-phone">Office contact details</Label>
          <Input id="am-phone" value={value.phone} onChange={(e) => setValue({ ...value, phone: e.target.value })} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={isPending || !dirty}>
          {isPending ? "Saving..." : "Save"}
        </Button>
        {saved && !dirty && <span className="text-body-sm text-muted-foreground">Saved.</span>}
        {error && <span className="text-body-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
