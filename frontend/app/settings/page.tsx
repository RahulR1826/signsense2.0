"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { PreferencesForm } from "@/components/preferences-form";
import { SaathiStyleSetting } from "@/components/saathi/saathi-style-setting";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { useMe } from "@/hooks/use-me";
import { ApiError, deleteAccount, updateProfile, type User } from "@/lib/auth";

function ProfileForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateProfile(name));
      toast({ title: "Name saved", description: "People in your calls will see the new name." });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name shown in calls</Label>
        <Input id="name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" className="h-12 text-base" value={user.email} disabled readOnly />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="xl" variant="outline" disabled={busy || !name.trim() || name.trim() === user.name}>
        {saved ? <><Check /> Saved</> : busy ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Nothing was deleted — try again.");
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-destructive/30 bg-card p-6" aria-labelledby="danger-title">
      <h2 id="danger-title" className="flex items-center gap-2 text-lg font-semibold text-destructive">
        <AlertTriangle className="size-5" aria-hidden /> Delete account
      </h2>
      <p className="text-sm text-muted-foreground">
        Permanently deletes your account, preferences and the meetings you hosted. In other people&apos;s meeting history your name is
        replaced with &ldquo;Deleted user&rdquo;. This can&apos;t be undone.
      </p>
      {!open ? (
        <Button variant="outline" size="lg" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="delete-password">Type your password to confirm</Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              className="h-12 max-w-sm text-base"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "delete-error" : undefined}
              autoFocus
            />
          </div>
          {error && (
            <p id="delete-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" size="lg" disabled={busy || !password}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} Delete permanently
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)} disabled={busy}>
              Keep my account
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, setUser } = useMe();
  const { toast } = useToast();

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold sm:text-4xl">Settings</h1>
        {user && (
          <>
            <section className="space-y-4 rounded-2xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Profile</h2>
              <ProfileForm user={user} onSaved={setUser} />
            </section>
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">How you communicate</h2>
              <PreferencesForm
                initial={user.preferences}
                submitLabel="Save preferences"
                onSaved={(preferences) => {
                  setUser({ ...user, preferences });
                  toast({ title: "Preferences saved", description: "Your next call will use them." });
                }}
              />
            </section>
            <section className="space-y-4" aria-labelledby="saathi-title">
              <div>
                <h2 id="saathi-title" className="text-lg font-semibold">Saathi, your signing guide</h2>
                <p className="text-sm text-muted-foreground">Saathi signs words for you in calls and in the dictionary. Choose how she looks on this device.</p>
              </div>
              <SaathiStyleSetting />
            </section>
            <section className="space-y-2 rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
              <h2 className="text-lg font-semibold text-foreground">Privacy</h2>
              <p>Sign recognition runs in this browser. Video and audio go directly to the other person and are never uploaded to or stored by SignSense.</p>
              <p>Live captions use your browser&apos;s speech service, which may send audio to its provider (for Chrome, Google). They are off until you turn them on in a call.</p>
            </section>
            <DeleteAccount
              onDeleted={() => {
                // Don't clear `user` here: this page redirects signed-out visitors to /login, which would
                // race this navigation. The home page loads the (now signed-out) state itself.
                toast({ title: "Your account was deleted" });
                router.replace("/");
              }}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
