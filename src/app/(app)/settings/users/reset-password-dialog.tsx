"use client";

import { useActionState, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resetUserPassword } from "@/app/(app)/settings/users/actions";

export function ResetPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, formAction, isPending] = useActionState(resetUserPassword, { error: null });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setCopied(false);
  }

  async function handleCopy() {
    if (!state.credentials) return;
    const text = `App: ${state.credentials.appUrl}\nEmail: ${state.credentials.email}\nPassword: ${state.credentials.password}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Reset password
      </DialogTrigger>
      <DialogContent>
        {state.credentials ? (
          <>
            <DialogHeader>
              <DialogTitle>Password reset</DialogTitle>
              <DialogDescription>
                Copy these details now and share them with the employee yourself. They&apos;ll be
                required to change it on next login.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-md border border-border bg-muted p-4 text-body-sm">
              <div>
                <span className="text-muted-foreground">App URL: </span>
                {state.credentials.appUrl}
              </div>
              <div>
                <span className="text-muted-foreground">Email: </span>
                {state.credentials.email}
              </div>
              <div>
                <span className="text-muted-foreground">Password: </span>
                {state.credentials.password}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCopy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy details"}
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="email" value={email} />
            <DialogHeader>
              <DialogTitle>Reset password for {email}</DialogTitle>
              <DialogDescription>
                Set a new password. The user will be required to change it on their next login.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="new_password">New password</Label>
                <Input id="new_password" name="password" type="text" required minLength={8} />
              </div>
              {state.error && <p className="text-body-sm text-destructive">{state.error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
