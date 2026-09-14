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
import type { DepartmentOption } from "@/lib/departments";

const ROLE_LABELS: Record<string, string> = {
  user: "User",
  manager: "Manager",
  admin: "Admin",
};

export function CreateUserDialog({
  departments = [],
  emailConfigured = false,
}: {
  departments?: DepartmentOption[];
  /** Whether the app can send the invitation itself. Without it the admin hands the details over. */
  emailConfigured?: boolean;
}) {
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
        {state.credentials || state.invitation ? (
          <>
            <DialogHeader>
              <DialogTitle>{state.invitation?.sent ? "Invitation sent" : "Account created"}</DialogTitle>
              <DialogDescription>
                {state.invitation?.sent
                  ? `An email has gone to ${state.invitation.to} with a link that signs them in and asks them to choose a password. It works once and for a limited time; if it expires, Forgot password on the sign-in page sends a fresh one.`
                  : "Copy these details now and share them with the employee yourself. This password won't be shown again."}
              </DialogDescription>
            </DialogHeader>
            {/* Said in red rather than as a missing email nobody notices. */}
            {state.invitation && !state.invitation.sent && (
              <p className="text-body-sm text-destructive">
                The invitation was not emailed. {state.invitation.note}
              </p>
            )}
            {state.credentials && (
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
            )}
            <DialogFooter>
              {state.credentials && (
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy details"}
                </Button>
              )}
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Invite new user</DialogTitle>
              <DialogDescription>
                {emailConfigured
                  ? "They get an email with a link that signs them in and asks them to choose a password. Set a password here only if you would rather hand the details over yourself."
                  : "Email is not set up on this system, so set their initial password yourself and pass it on. They will be asked to change it on first sign-in."}
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
                <Label htmlFor="password">{emailConfigured ? "Initial password (optional)" : "Initial password"}</Label>
                <Input id="password" name="password" type="text" required={!emailConfigured} minLength={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select name="role" defaultValue="user">
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue>
                      {(v) => ROLE_LABELS[String(v)] ?? "User"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Set at creation rather than as a second step afterwards. A
                  manager with no department sees no tenders at all, so leaving
                  it out made every new account look broken on first sign-in. */}
              <div className="space-y-1.5">
                <Label htmlFor="department_id">Department</Label>
                <Select name="department_id" defaultValue="none">
                  <SelectTrigger id="department_id" className="w-full">
                    <SelectValue>
                      {(v) =>
                        departments.find((d) => d.id === String(v))?.name ?? "No department"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-label-sm text-muted-foreground">
                  Admins see all four. Anybody else sees only their own, so a manager left
                  without one sees no tenders at all.
                </p>
              </div>
              {state.error && <p className="text-body-sm text-destructive">{state.error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? (emailConfigured ? "Inviting..." : "Creating...") : emailConfigured ? "Send invitation" : "Create account"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
