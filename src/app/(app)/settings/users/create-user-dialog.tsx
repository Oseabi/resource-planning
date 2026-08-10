"use client";

import { useActionState, useState } from "react";
import { UserPlus, Copy, Check } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEmployeeAccount } from "@/app/(app)/settings/users/actions";

export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, formAction, isPending] = useActionState(createEmployeeAccount, { error: null });

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
      <DialogTrigger render={<Button />}>
        <UserPlus className="size-4" />
        Invite New User
      </DialogTrigger>
      <DialogContent>
        {state.credentials ? (
          <>
            <DialogHeader>
              <DialogTitle>Account created</DialogTitle>
              <DialogDescription>
                Copy these details now and share them with the employee yourself. This password
                won&apos;t be shown again.
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
            <DialogHeader>
              <DialogTitle>Invite new user</DialogTitle>
              <DialogDescription>
                Set their initial password yourself, they&apos;ll be required to change it on
                first login.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" name="full_name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Initial password</Label>
                <Input id="password" name="password" type="text" required minLength={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select name="role" defaultValue="user">
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {state.error && <p className="text-body-sm text-destructive">{state.error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating..." : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
